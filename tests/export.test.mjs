import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { defaults, validate } from '../public/model.js';
import { generate, tar } from '../lib/export.mjs';

function valid() { const p = defaults(); p.users[0].sshKeys = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB test'; return p; }
const bash = process.env.BASH_PATH || (existsSync('C:/Tools/Git/bin/bash.exe') ? 'C:/Tools/Git/bin/bash.exe' : 'bash');

test('preflight allows upstream-managed genimage and reports configuration failures', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'pi-preflight-'));
  await fs.mkdir(path.join(dir,'layer'));
  await fs.writeFile(path.join(dir,'config.yaml'),'device: {}\n');
  const script = generate(valid()).files['build.sh'].content;
  // Use a complete bundle: preflight also restores overlay modes after copying.
  for (const [name, file] of Object.entries(generate(valid()).files)) {
    const target = path.join(dir, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content);
  }
  assert.doesNotMatch(script,/command -v genimage/);
  assert.match(script,/umask 022/);
  assert.doesNotMatch(script,/umask 077/);
  await fs.writeFile(path.join(dir,'build.sh'),script);
  await fs.writeFile(path.join(dir,'mock-gen'), '#!/bin/bash\n[[ $(umask) == 0022 ]] || { echo "Incorrect build umask" >&2; exit 43; }; if [[ "$1" == config && "${FAIL_GENERATOR:-}" == yes ]]; then echo "Mock config error"; exit 42; fi\n');
  const harness = `
source_dir="$1"
if command -v cygpath >/dev/null; then source_dir=$(cygpath -u "$source_dir"); fi
uname() { echo Linux; }
command() { if [[ "$*" == '-v genimage' ]]; then return 1; else builtin command "$@"; fi; }
export -f uname command
export RPI_IMAGE_GEN="$source_dir/mock-gen"
chmod +x "$RPI_IMAGE_GEN"
umask 077
bash "$source_dir/build.sh" --check
`;
  const run = fail => spawnSync(bash,['-c',harness,'test',dir],{encoding:'utf8',env:{...process.env,FAIL_GENERATOR:fail}});
  const passed = run('no'); assert.equal(passed.status,0,passed.stderr); assert.match(passed.stdout,/Preflight passed/);
  const failed = run('yes'); assert.equal(failed.status,42,failed.stderr);
  assert.match(failed.stdout,/Mock config error/);
  assert.match(failed.stderr,/parsing project configuration.*exit 42/);
});
test('default draft prevents SSH lockout, valid key enables export', () => {
  assert.match(validate(defaults()).errors.map(e => e.message).join(), /no user can log in/);
  assert.equal(validate(valid()).errors.length, 0);
  assert.throws(() => generate(defaults()), /Fix configuration/);
});
test('malformed project shapes are identified before interpretation', () => {
  for (const p of [null, {}, { ...valid(), users: [null] }, { ...valid(), system: {} }, { ...valid(), storage: { ...valid().storage, partitions: null } }]) assert.ok(validate(p).malformed);
});
test('validates identity, network, storage and injection boundaries', () => {
  const p = valid(); p.project.slug = '../outside'; p.system.hostname = '$(touch /tmp/no)';
  p.users.push({ ...p.users[0] }); p.network.ethernet = 'manual'; p.network.address = '999.1.1.1/33';
  p.storage.partitions = [{ label: 'ROOT', size: '-1G', mount: '/../../etc' }];
  p.advanced.files = [{ path: '/etc/../outside', content: '', executable: false }];
  const errors = validate(p).errors;
  for (const section of ['overview','system','users','network','storage','advanced']) assert.ok(errors.some(e => e.section === section), section);
});
test('generated YAML maps documented settings and deterministic checksums', () => {
  const p = valid(); p.system.storage = 'nvme'; p.storage.rootFs = 'btrfs';
  const a = generate(p).files, b = generate(p).files;
  assert.deepEqual(a, b);
  assert.match(a['config.yaml'].content, /storage_type: "nvme"/);
  assert.match(a['config.yaml'].content, /rootfs_type: "btrfs"/);
  assert.match(a['build.sh'].content, /\$\{BASH_SOURCE\[0\]\}/);
  assert.match(a['build.sh'].content, /build -S "\$SOURCE" -c/);
  const manifest = JSON.parse(a['manifest.json'].content);
  for (const [name, hash] of Object.entries(manifest.files)) assert.equal(createHash('sha256').update(a[name].content).digest('hex'), hash);
  assert.equal(a['layer/my-raspberry-pi-settings.d/hooks/late/customize99-my-raspberry-pi'].mode, 0o700);
});
test('gadget, user, Wi-Fi and custom content reach the generated hook safely', () => {
  const p = valid(); p.gadget.enabled = true; p.network.wifi = true; p.network.ssid = "Lab's $(touch nope)"; p.network.psk = 'safe$(nope)123';
  p.users.push({ ...p.users[0], name: 'operator', groups: 'users', sudo: 'nopasswd' });
  p.advanced.files.push({ path: '/etc/demo.conf', content: 'EOF\n$(not executed)\n', executable: false });
  const f = generate(p).files, hook = f['layer/my-raspberry-pi-settings.d/hooks/late/customize99-my-raspberry-pi'].content;
  assert.match(hook, /useradd.*operator/);
  assert.doesNotMatch(hook, /nmcli|config.txt/);
  const overlay = 'layer/my-raspberry-pi-settings.d/customize.overlay';
  assert.match(f['layer/my-raspberry-pi-settings.d/for/rpi-boot-firmware/config.txt.d/90-my-raspberry-pi'].content, /dtoverlay=dwc2,dr_mode=peripheral/);
  assert.ok(f[overlay + '/etc/NetworkManager/system-connections/my-raspberry-pi-wifi.nmconnection'].content.includes("ssid=Lab's $(touch nope)"));
  assert.equal(f[overlay + '/etc/NetworkManager/system-connections/my-raspberry-pi-wifi.nmconnection'].mode, 0o600);
  assert.equal(f[overlay + '/etc/demo.conf'].content, 'EOF\n$(not executed)\n');
  assert.match(f['layer/my-raspberry-pi-settings.yaml'].content, /dnsmasq-base/);
});
test('tar is readable and preserves text and executable permissions', async () => {
  const p = valid(), files = generate(p).files;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'picreator-tar-'));
  const target = path.join(dir, 'bundle.tar'); await fs.writeFile(target, tar(files, p.project.slug));
  const result = spawnSync('python', ['-c', 'import tarfile,sys; t=tarfile.open(sys.argv[1]); assert t.getmember("my-raspberry-pi/build.sh").mode == 448; assert t.extractfile("my-raspberry-pi/project.json").read().startswith(b"{"); print(len(t.getmembers()))', target], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(Number(result.stdout), Object.keys(files).length);
});
test('custom layouts are complete native layers before the build starts', () => {
  for (const table of ['mbr','gpt']) for (const rootFs of ['ext4','btrfs']) {
    const p = valid(); p.storage.table = table; p.storage.rootFs = rootFs;
    p.storage.partitions = [{ label:'DATA', mount:'/data/app', size:'2G' }];
    const f = generate(p).files, template = f['layer/my-raspberry-pi-image.d/genimage.cfg.in'].content;
    assert.match(f['config.yaml'].content, /layer: "my-raspberry-pi-image"/);
    assert.ok(template.includes('partition-table-type = "' + table + '"'));
    assert.ok(template.includes('image root.' + rootFs));
    assert.match(template, /partition data0/); assert.match(template, /size = 2G/);
    assert.match(f['layer/my-raspberry-pi-image.d/fstab'].content, /LABEL=DATA \/data\/app/);
    assert.ok(Object.keys(f).every(path => !path.endsWith('.py')));
    assert.doesNotMatch(f['build.sh'].content, /python|prepare-layout|cp |sed /);
    assert.match(f['layer/my-raspberry-pi-image.yaml'].content, /Requires: image-rpios/);
  }
});

test('all generated shell scripts parse with Bash, including special-character inputs', async () => {
  const p = valid(); p.gadget.enabled = true; p.network.wifi = true; p.network.ssid = "Lab's $(test)"; p.network.psk = 'quoted!123'; p.hardware.config = 'dtparam=audio=on';
  p.storage.table = 'gpt';
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'picreator-bash-'));
  for (const [name, f] of Object.entries(generate(p).files)) if (f.content.startsWith('#!/bin/bash')) {
    const filename = path.join(dir, path.basename(name)); await fs.writeFile(filename, f.content);
    const syntax = spawnSync(bash, ['-n', filename], { encoding: 'utf8' }); assert.equal(syntax.status, 0, name + ': ' + syntax.stderr);
  }
});

test('native preimage hook resolves build paths and filesystem IDs without reading installed templates', async () => {
  const p = valid(); p.storage.table = 'gpt'; p.storage.partitions = [{label:'DATA',mount:'/data/app',size:'2G'}];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'picreator native '));
  const files = generate(p).files;
  for (const [name, f] of Object.entries(files)) { const dest = path.join(dir, name); await fs.mkdir(path.dirname(dest), {recursive:true}); await fs.writeFile(dest, f.content); }
  const work = path.join(dir, 'work'); await fs.mkdir(work);
  await fs.writeFile(path.join(work,'img_uuids'), 'ROOT_UUID=00000000-0000-0000-0000-000000000001\nBOOT_LABEL=12345678\n');
  const command = process.platform === 'win32' ? 'script=$(cygpath -u "$1"); output=$(cygpath -u "$2"); bash "$script" "$output" "$output"' : 'bash "$1" "$2" "$2"';
  const result = spawnSync(bash, ['-c', command, 'test', path.join(dir,'layer/my-raspberry-pi-image.d/hooks/preimage99-layout'), work], {encoding:'utf8',env:{...process.env,IGconf_image_rootfs_type:'ext4',IGconf_image_name:'test',IGconf_image_suffix:'img',IGconf_image_boot_part_size:'512M',IGconf_image_root_part_size:'8G',IGconf_image_disksig:'0x12345678',IGconf_device_sector_size:'512',IGconf_fs_ext4_mkfs_args:'-F -b 4096'}});
  assert.equal(result.status,0,result.stderr);
  const config = await fs.readFile(path.join(work,'genimage.cfg'),'utf8');
  assert.doesNotMatch(config, /<[A-Z_]+>/); assert.match(config, /image test.img/); assert.match(config, /-U 00000000-0000-0000-0000-000000000001/);
  assert.match(config, /partition data0/); assert.match(config, /picreator native /);
});

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
  assert.equal(a['layer/picreator-project.d/hooks/late/customize99-picreator'].mode, 0o700);
});
test('gadget, user, Wi-Fi and custom content reach the generated hook safely', () => {
  const p = valid(); p.gadget.enabled = true; p.network.wifi = true; p.network.ssid = "Lab's $(touch nope)"; p.network.psk = 'safe$(nope)123';
  p.users.push({ ...p.users[0], name: 'operator', groups: 'users', sudo: 'nopasswd' });
  p.advanced.files.push({ path: '/etc/demo.conf', content: 'EOF\n$(not executed)\n', executable: false });
  const f = generate(p).files, hook = f['layer/picreator-project.d/hooks/late/customize99-picreator'].content;
  assert.match(hook, /useradd.*operator/);
  assert.match(hook, /nmcli --offline connection add/);
  assert.match(hook, /dtoverlay=dwc2,dr_mode=peripheral/);
  assert.match(hook, /'Lab'"'"'s \$\(touch nope\)'/);
  assert.ok(hook.includes(Buffer.from('EOF\n$(not executed)\n').toString('base64')));
  assert.match(f['layer/picreator-project.yaml'].content, /dnsmasq-base/);
});
test('tar is readable and preserves text and executable permissions', async () => {
  const p = valid(), files = generate(p).files;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'picreator-tar-'));
  const target = path.join(dir, 'bundle.tar'); await fs.writeFile(target, tar(files, p.project.slug));
  const result = spawnSync('python', ['-c', 'import tarfile,sys; t=tarfile.open(sys.argv[1]); assert t.getmember("my-raspberry-pi/build.sh").mode == 448; assert t.extractfile("my-raspberry-pi/project.json").read().startswith(b"{"); print(len(t.getmembers()))', target], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(Number(result.stdout), Object.keys(files).length);
});
test('partition adapter generates GPT and data partitions from a compatible installed layer', async () => {
  const p = valid(); p.storage.table = 'gpt'; p.storage.partitions = [{ label: 'DATA', mount: '/data/app', size: '2G' }];
  const files = generate(p).files;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'picreator-layout-'));
  const source = path.join(dir, 'project'), upstream = path.join(dir, 'upstream'), assets = path.join(upstream, 'image/mbr/simple_dual');
  await fs.mkdir(assets, { recursive: true });
  for (const [name, f] of Object.entries(files)) { const target = path.join(source, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, f.content); }
  await fs.writeFile(path.join(assets, 'image.yaml'), '# X-Env-Layer-Name: image-rpios\n');
  await fs.writeFile(path.join(assets, 'setup.sh'), '#!/bin/bash\necho original\n');
  await fs.writeFile(path.join(assets, 'genimage.cfg.in.ext4'), 'image disk {\n hdimage { partition-table-type = "mbr" disk-signature = "<DISK_SIGNATURE>" }\n partition boot { partition-type = 0xC bootable = true }\n partition root { partition-type = 0x83 image = root.ext4 }\n}\nimage boot.vfat { vfat {} }\nimage root.ext4 { exec-pre = "<SETUP> ROOT" }\n');
  const result = spawnSync('python', [path.join(source, 'scripts/prepare-layout.py'), path.join(upstream, 'rpi-image-gen'), source], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const target = path.join(source, 'layer/picreator-image');
  const template = await fs.readFile(path.join(target, 'genimage.cfg.in.ext4'), 'utf8');
  assert.match(template, /partition-table-type = "gpt"/); assert.match(template, /partition-type-uuid = U/); assert.match(template, /partition data0/); assert.match(template, /empty = true/);
  assert.ok(template.indexOf('partition data0') > template.indexOf('partition root'));
  assert.match(await fs.readFile(path.join(target, 'setup.sh'), 'utf8'), /LABEL=DATA \/data\/app ext4/);
  const syntax = spawnSync(bash, ['-n', path.join(target, 'setup.sh')], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  assert.match(await fs.readFile(path.join(target, 'image.yaml'), 'utf8'), /Name: picreator-image/);
  assert.match(files['config.yaml'].content, /layer: "picreator-image"/);
  // Repeating preparation must not wrap the wrapper recursively.
  const again = spawnSync('python', [path.join(source, 'scripts/prepare-layout.py'), path.join(upstream, 'rpi-image-gen'), source], { encoding: 'utf8' });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(await fs.readFile(path.join(target, 'setup-upstream.sh'), 'utf8'), '#!/bin/bash\necho original\n');
  await fs.writeFile(path.join(assets, 'genimage.cfg.in.ext4'), 'changed upstream format');
  const bad = spawnSync('python', [path.join(source, 'scripts/prepare-layout.py'), path.join(upstream, 'rpi-image-gen'), source], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0); assert.match(bad.stderr, /Unsupported installed/);
});

test('all generated shell scripts parse with Bash, including special-character inputs', async () => {
  const p = valid(); p.gadget.enabled = true; p.network.wifi = true; p.network.ssid = "Lab's $(test)"; p.network.psk = 'quoted!123'; p.hardware.config = 'dtparam=audio=on';
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'picreator-bash-'));
  for (const [name, f] of Object.entries(generate(p).files)) if (f.content.startsWith('#!/bin/bash')) {
    const filename = path.join(dir, path.basename(name)); await fs.writeFile(filename, f.content);
    const syntax = spawnSync(bash, ['-n', filename], { encoding: 'utf8' }); assert.equal(syntax.status, 0, name + ': ' + syntax.stderr);
  }
});

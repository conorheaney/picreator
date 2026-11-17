import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { defaults } from '../public/model.js';
import { generate } from '../lib/export.mjs';

test('root builder configuration replaces pending OOBE and preserves other settings and original backups', async t => {
  const bash = process.env.BASH_PATH || (existsSync('C:/Tools/Git/bin/bash.exe') ? 'C:/Tools/Git/bin/bash.exe' : 'bash');
  const template = await fs.readFile('templates/create-rpi-builder.ps1','utf8');
  const start = template.indexOf('set_builder_ini()');
  const end = template.indexOf('# Update package metadata',start);
  const block = template.slice(start,end)
    .replaceAll('/etc/wsl-distribution.conf', '"$workdir/distribution.conf"')
    .replaceAll('/etc/wsl.conf', '"$workdir/wsl.conf"');
  const harness = `set -euo pipefail
workdir=$(mktemp -d)
trap 'rm -f "$workdir"/*; rmdir "$workdir"' EXIT
printf '[oobe]\\ncommand = /old/wizard\\ndefaultUid=1000\\n[shortcut]\\nenabled=true\\n' > "$workdir/distribution.conf"
printf '[boot]\\nsystemd=true\\n[user]\\ndefault=developer\\n' > "$workdir/wsl.conf"
` + block + block + `
grep -q '^command = /bin/true$' "$workdir/distribution.conf"
grep -q '^defaultUid = 0$' "$workdir/distribution.conf"
grep -q '^enabled=true$' "$workdir/distribution.conf"
grep -q '^systemd=true$' "$workdir/wsl.conf"
grep -q '^default = root$' "$workdir/wsl.conf"
test "$(grep -c '^command' "$workdir/distribution.conf")" = 1
grep -q '/old/wizard' "$workdir/distribution.conf.rpi-builder-original"
grep -q 'developer' "$workdir/wsl.conf.rpi-builder-original"
set_builder_ini "$workdir/new.conf" user default root
grep -q '^\\[user\\]$' "$workdir/new.conf"
grep -q '^default = root$' "$workdir/new.conf"
`;
  const r = spawnSync(bash,['-c',harness],{encoding:'utf8'});
  if (r.error?.code === 'ENOENT') { t.skip('Bash is unavailable.'); return; }
  assert.equal(r.status,0,r.stderr || r.error?.message);
});

test('ARM64 registration accepts a working kernel handler without querying the legacy database', async t => {
  const bash = process.env.BASH_PATH || (existsSync('C:/Tools/Git/bin/bash.exe') ? 'C:/Tools/Git/bin/bash.exe' : 'bash');
  const template = await fs.readFile('templates/create-rpi-builder.ps1','utf8');
  const start = template.indexOf('        arm64_handler_ready()');
  const end = template.indexOf('        ;;',start);
  const block = template.slice(start,end)
    .replaceAll('/proc/sys/fs/binfmt_misc/qemu-aarch64', '"$fixture"')
    .replaceAll('/usr/lib/systemd/systemd-binfmt', '/no-test-systemd-loader')
    .replaceAll('/usr/lib/binfmt.d/qemu-aarch64.conf', '/no-test-systemd-rule')
    .replaceAll('/usr/share/binfmts/qemu-aarch64', '/no-test-legacy-rule');
  const harness = `set -euo pipefail
fixture=$(mktemp)
trap 'rm -f "$fixture"' EXIT
mountpoint() { return 0; }
mount() { exit 98; }
update-binfmts() { exit 99; }
printf 'enabled\\nflags: %s\\n' "$1" > "$fixture"
` + block;
  const valid = spawnSync(bash, ['-c',harness,'test','F'],{encoding:'utf8'});
  if (valid.error?.code === 'ENOENT') { t.skip('Bash is unavailable.'); return; }
  assert.equal(valid.status,0,valid.stderr || valid.error?.message);
  assert.match(valid.stdout,/enabled/);
  const invalid = spawnSync(bash, ['-c',harness,'test','P'],{encoding:'utf8'});
  assert.equal(invalid.status,1,invalid.stderr || invalid.error?.message);
  assert.match(invalid.stderr,/No packaged ARM64/);
});

test('builder reset is shipped at bundle root and documented as destructive', () => {
  const p = defaults(); p.ssh.enabled = false;
  const f = generate(p).files;
  assert.ok(f['create-rpi-builder.ps1']);
  assert.match(f['README.md'].content, /create-rpi-builder.ps1/);
  assert.match(f['README.md'].content, /permanently deletes/);
  assert.match(f['create-rpi-builder.ps1'].content, /SupportsShouldProcess/);
  assert.doesNotMatch(f['create-rpi-builder.ps1'].content, /Remove-Item|--shutdown/);
});

test('PowerShell reset targets only rpi-builder, respects WhatIf and stops before destructive work on unsupported WSL', async t => {
  const ps = 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
  if (!existsSync(ps)) { t.skip('Windows PowerShell is required for the mocked WSL integration test.'); return; }
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'builder-script-test-'));
  const harness = path.join(temp, 'mock-wsl.ps1');
  await fs.writeFile(harness, `param([string]$ScriptPath, [string]$Scenario)
$global:Calls = [System.Collections.Generic.List[object]]::new()
$global:Created = $false
# Shadow wsl.exe completely: no real WSL command or distribution is ever touched.
function global:wsl.exe {
  param([Parameter(ValueFromRemainingArguments=$true)][string[]]$CommandArgs)
  $global:Calls.Add(@($CommandArgs))
  $global:LASTEXITCODE = 0
  switch ($CommandArgs[0]) {
    '--help' {
      if ($Scenario -eq 'help-negative') { $global:LASTEXITCODE = -1 }
      if ($Scenario -eq 'help-failed') { $global:LASTEXITCODE = -1; return 'WSL could not start.' }
      if ($Scenario -eq 'old') { return "    --install\n        --no-launch\n    --mount\n        --name <Name>\n    --manage\n        --set-default-user <User>" }
      return "    --install\n        --name <Name>\n        --version <Version>\n        --no-launch\n    --manage\n        --set-default-user <User>"
    }
    '--list' {
      'Ubuntu'; 'Ubuntu-24.04'; 'rpi-builder-old'
      if ($global:Created -or $Scenario -notin @('new','resume-missing')) { 'rpi-builder' }
    }
    '--install' { if ($Scenario -eq 'install-fails') { $global:LASTEXITCODE = 1 } else { $global:Created = $true } }
    '--unregister' { if ($Scenario -eq 'unregister-fails') { $global:LASTEXITCODE = -1 } }
    '--distribution' { if ($Scenario -eq 'setup-fails') { $global:LASTEXITCODE = 1 } }
  }
}
$failure = $null
try {
  if ($Scenario -eq 'whatif') { & $ScriptPath -WhatIf }
  elseif ($Scenario -eq 'resume-whatif') { & $ScriptPath -SetupOnly -WhatIf }
  elseif ($Scenario -like 'resume*') { & $ScriptPath -SetupOnly }
  else { & $ScriptPath }
} catch { $failure = $_.Exception.Message }
Write-Output ('RESULT:' + (@{ calls=@($global:Calls.ToArray()); failure=$failure } | ConvertTo-Json -Depth 6 -Compress))
`);
  const script = path.resolve('templates/create-rpi-builder.ps1');
  const run = scenario => {
    const r = spawnSync(ps, ['-NoProfile','-NonInteractive','-File',harness,script,scenario], {encoding:'utf8'});
    assert.equal(r.status,0,r.stderr || r.error?.message);
    const result = r.stdout.split(/\r?\n/).find(line => line.startsWith('RESULT:'));
    assert.ok(result,r.stdout); return JSON.parse(result.slice(7));
  };
  const replaced = run('existing'); assert.equal(replaced.failure,null);
  assert.deepEqual(replaced.calls.find(c => c[0] === '--unregister'), ['--unregister','rpi-builder']);
  assert.deepEqual(replaced.calls.find(c => c[0] === '--install'), ['--install','--distribution','Ubuntu-24.04','--name','rpi-builder','--version','2','--no-launch']);
  assert.deepEqual(replaced.calls.find(c => c[0] === '--manage'), ['--manage','rpi-builder','--set-default-user','root']);
  const setup = replaced.calls.find(c => c[0] === '--distribution');
  assert.deepEqual(setup.slice(0,9), ['--distribution','rpi-builder','--user','root','--exec','/bin/bash','-o','pipefail','-c']);
  const encoded = setup[9].match(/printf '%s' '([A-Za-z0-9+/=]+)'/)[1];
  const bootstrap = Buffer.from(encoded,'base64').toString('utf8');
  assert.match(bootstrap, /git clone https:\/\/github.com\/raspberrypi\/rpi-image-gen.git/);
  assert.match(bootstrap, /bash \.\/install_deps.sh/);
  assert.match(bootstrap, /case "\$\(uname -m\)"/);
  assert.match(bootstrap, /update-binfmts --enable qemu-aarch64/);
  assert.match(bootstrap, /rpi-image-gen-revision.txt/);
  const bash = process.env.BASH_PATH || (existsSync('C:/Tools/Git/bin/bash.exe') ? 'C:/Tools/Git/bin/bash.exe' : 'bash');
  const syntax = spawnSync(bash, ['-n'], { input:bootstrap, encoding:'utf8' });
  assert.equal(syntax.status,0,syntax.stderr || syntax.error?.message);
  assert.ok(replaced.calls.indexOf(setup) > replaced.calls.findIndex(c => c[0] === '--manage'));
  const fresh = run('new'); assert.equal(fresh.failure,null); assert.ok(!fresh.calls.some(c => c[0] === '--unregister'));
  const resumed = run('resume'); assert.equal(resumed.failure,null);
  assert.ok(resumed.calls.some(c => c[0] === '--distribution'));
  assert.ok(!resumed.calls.some(c => ['--unregister','--install','--manage'].includes(c[0])));
  const resumeWhatIf = run('resume-whatif'); assert.equal(resumeWhatIf.failure,null);
  assert.ok(!resumeWhatIf.calls.some(c => ['--unregister','--install','--manage','--distribution'].includes(c[0])));
  const missing = run('resume-missing'); assert.match(missing.failure,/does not exist/);
  assert.ok(!missing.calls.some(c => ['--unregister','--install','--manage','--distribution'].includes(c[0])));
  const helpNegative = run('help-negative'); assert.equal(helpNegative.failure,null); assert.ok(helpNegative.calls.some(c => c[0] === '--install'));
  for (const scenario of ['whatif','old','help-failed']) {
    const r = run(scenario); assert.ok(!r.calls.some(c => ['--unregister','--install','--manage','--distribution'].includes(c[0])));
    if (scenario !== 'whatif') assert.match(r.failure,/No distribution has been removed/);
  }
  const failedRemoval = run('unregister-fails'); assert.ok(failedRemoval.failure); assert.ok(!failedRemoval.calls.some(c => c[0] === '--install'));
  const failedInstall = run('install-fails'); assert.ok(failedInstall.failure); assert.ok(!failedInstall.calls.some(c => c[0] === '--manage'));
  const failedSetup = run('setup-fails'); assert.ok(failedSetup.failure); assert.match(failedSetup.failure,/WSL command failed/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { defaults } from '../public/model.js';
import { generate } from '../lib/export.mjs';

test('WSL build launcher copies the selected bundle, checks first, preserves builds and propagates errors', async t => {
  const ps = 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
  if (!existsSync(ps)) { t.skip('Windows PowerShell required.'); return; }
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "pi build's test-"));
  const p = defaults(); p.ssh.enabled = false;
  const files = generate(p).files;
  assert.ok(files['build-in-wsl.ps1']);
  for (const [name,file] of Object.entries(files)) {
    const target = path.join(temp,name);
    await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.writeFile(target,file.content);
  }
  const harness = path.join(temp,'mock.ps1');
  await fs.writeFile(harness, `param([string]$ScriptPath,[string]$Scenario)
$global:Calls = [System.Collections.Generic.List[object]]::new()
function global:wsl.exe {
 param([Parameter(ValueFromRemainingArguments=$true)][string[]]$CommandArgs)
 $global:Calls.Add(@($CommandArgs)); $global:LASTEXITCODE=0
 if ($CommandArgs[0] -eq '--list') {
   if ($Scenario -ne 'missing') { 'rpi-builder' } else { 'Ubuntu' }
 }
 if ($CommandArgs[0] -eq '--distribution' -and $Scenario -eq 'fail') { $global:LASTEXITCODE=7 }
}
$failure=$null
try {
 if ($Scenario -eq 'whatif') { & $ScriptPath -WhatIf }
 elseif ($Scenario -eq 'check') { & $ScriptPath -CheckOnly }
 else { & $ScriptPath }
} catch { $failure=$_.Exception.Message }
'RESULT:' + (@{calls=@($global:Calls.ToArray());failure=$failure} | ConvertTo-Json -Depth 6 -Compress)
`);
  const run = scenario => {
    const r = spawnSync(ps,['-NoProfile','-NonInteractive','-File',harness,path.join(temp,'build-in-wsl.ps1'),scenario],{encoding:'utf8'});
    assert.equal(r.status,0,r.stderr || r.error?.message);
    const line = r.stdout.split(/\r?\n/).find(x=>x.startsWith('RESULT:'));
    assert.ok(line,r.stdout); return JSON.parse(line.slice(7));
  };
  const built = run('build'); assert.equal(built.failure,null);
  const setup = built.calls.find(c=>c[0]==='--distribution');
  assert.deepEqual(setup.slice(0,9),['--distribution','rpi-builder','--user','root','--exec','/bin/bash','-o','pipefail','-c']);
  const decode = c => Buffer.from(c[9].match(/printf '%s' '([A-Za-z0-9+/=]+)'/)[1],'base64').toString();
  const bash = decode(setup);
  assert.match(bash,/mktemp -d '\/root\/pi-projects\//);
  assert.match(bash,/cp --parents/);
  assert.ok(bash.indexOf("umask 022") > bash.indexOf('chmod -R go-rwx'));
  assert.ok(bash.indexOf("umask 022") < bash.indexOf("bash ./build.sh --check"));
  assert.match(bash,/bash \.\/build.sh --check/);
  assert.match(bash,/if \[\[ 'build' == build/);
  assert.ok(bash.indexOf('build.sh --check') < bash.indexOf('bash ./build.sh </dev/null'));
  assert.doesNotMatch(bash,/rm -rf|__PATH__|__SLUG__|__FILES__/);
  assert.ok(bash.includes(Buffer.from(temp).toString('base64')));
  const shell = process.env.BASH_PATH || (existsSync('C:/Tools/Git/bin/bash.exe') ? 'C:/Tools/Git/bin/bash.exe' : 'bash');
  const syntax = spawnSync(shell,['-n'],{input:bash,encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr || syntax.error?.message);
  const checked = run('check'); assert.equal(checked.failure,null);
  assert.match(decode(checked.calls.find(c=>c[0]==='--distribution')),/if \[\[ 'check' == build/);
  const whatif = run('whatif'); assert.equal(whatif.failure,null); assert.equal(whatif.calls.length,0);
  const missing = run('missing'); assert.match(missing.failure,/rpi-builder is missing/); assert.equal(missing.calls.length,1);
  assert.match(run('fail').failure,/exit 7/);
  await fs.appendFile(path.join(temp,'config.yaml'),'# changed');
  const modified = run('build'); assert.match(modified.failure,/checksum mismatch/); assert.equal(modified.calls.length,0);
});

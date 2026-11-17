import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { defaults } from '../public/model.js';
import { generate } from '../lib/export.mjs';

test('builder snapshots export safely and validate before replacing only rpi-builder', async t => {
  const ps = 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
  if (!existsSync(ps)) { t.skip('Windows PowerShell required'); return; }
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pi snapshot test-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const p = defaults(); p.ssh.enabled = false;
  const script = path.join(temp, 'snapshot.ps1');
  await fs.writeFile(script, generate(p).files['rpi-builder-snapshot.ps1'].content);
  const harness = path.join(temp, 'harness.ps1');
  await fs.writeFile(harness, `param($ScriptPath, $Scenario, $Folder)
$ErrorActionPreference='Stop'
$env:LOCALAPPDATA=$Folder
$global:Calls=[System.Collections.Generic.List[object]]::new()
$archive=Join-Path $Folder 'rpi-builder.tar'
Set-Content -LiteralPath $archive -Value 'baseline'
$original=(Get-FileHash -LiteralPath $archive).Hash
Set-Content -LiteralPath ($archive+'.sha256') -Value $original
if ($Scenario -eq 'corrupt') { Add-Content -LiteralPath $archive -Value 'changed' }
if ($Scenario -eq 'missing') { Remove-Item -LiteralPath $archive }
function global:wsl.exe {
 param([Parameter(ValueFromRemainingArguments=$true)][string[]]$CommandArgs)
 $global:Calls.Add(@($CommandArgs)); $global:LASTEXITCODE=0
 if ($CommandArgs[0] -eq '--list') { 'rpi-builder'; 'Ubuntu' }
 if ($CommandArgs[0] -eq '--export') {
   if ($Scenario -eq 'export-fail') { $global:LASTEXITCODE=5 }
   else { Set-Content -LiteralPath $CommandArgs[2] -Value 'exported baseline' }
 }
 if ($CommandArgs[0] -eq '--unregister' -and $Scenario -eq 'unregister-fail') { $global:LASTEXITCODE=6 }
}
$failure=$null
try {
 if ($Scenario -eq 'whatif') { & $ScriptPath restore -BackupPath $archive -WhatIf }
 elseif ($Scenario -in @('backup','export-fail')) { & $ScriptPath backup -BackupPath $archive }
 elseif ($Scenario -eq 'default-backup') { & $ScriptPath backup }
 elseif ($Scenario -eq 'default-restore') { & $ScriptPath restore }
 else { & $ScriptPath restore -BackupPath $archive }
} catch { $failure=$_.Exception.Message }
'RESULT:' + (@{calls=@($global:Calls.ToArray());failure=$failure;hash=$(if (Test-Path -LiteralPath $archive) { (Get-FileHash -LiteralPath $archive).Hash } else { '' });original=$original} | ConvertTo-Json -Depth 6 -Compress)
`);
  const run = scenario => {
    const r = spawnSync(ps, ['-NoProfile','-NonInteractive','-File',harness,script,scenario,temp], {encoding:'utf8'});
    assert.equal(r.status, 0, r.stderr);
    const line = r.stdout.split(/\r?\n/).find(x => x.startsWith('RESULT:'));
    assert.ok(line, r.stdout); return JSON.parse(line.slice(7));
  };
  const defaultBackup = run('default-backup'); assert.equal(defaultBackup.failure,null);
  assert.notEqual(defaultBackup.hash, defaultBackup.original);
  const defaultRestore = run('default-restore'); assert.equal(defaultRestore.failure,null);
  assert.equal(defaultRestore.calls.find(c=>c[0]==='--import')[3],path.join(temp,'rpi-builder.tar'));
  const backup = run('backup'); assert.equal(backup.failure, null);
  assert.deepEqual(backup.calls.map(c=>c[0]), ['--list','--terminate','--export']);
  assert.notEqual(backup.hash, backup.original);
  const failed = run('export-fail'); assert.match(failed.failure,/exit 5/); assert.equal(failed.hash,failed.original);
  for (const scenario of ['corrupt','missing','whatif']) {
    const r = run(scenario); assert.deepEqual(r.calls.map(c=>c[0]), ['--list']);
    if (scenario !== 'whatif') assert.ok(r.failure);
  }
  const restored = run('restore'); assert.equal(restored.failure,null);
  assert.deepEqual(restored.calls.map(c=>c[0]), ['--list','--unregister','--import','--manage']);
  assert.ok(restored.calls.every(c => c[0]==='--list' || c[1]==='rpi-builder'));
  assert.deepEqual(restored.calls[2].slice(-2), ['--version','2']);
  const blocked = run('unregister-fail'); assert.match(blocked.failure,/exit 6/);
  assert.deepEqual(blocked.calls.map(c=>c[0]), ['--list','--unregister']);
});

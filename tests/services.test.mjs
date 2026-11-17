import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, normalizeProject, validate, serviceDefaults } from '../public/model.js';
import { generate } from '../lib/export.mjs';
import { serviceUnit } from '../lib/services.mjs';

function project() {
  const p = defaults(); p.users[0].sshKeys = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB dev';
  p.serviceAccounts = [{ name: 'myservice', groups: '' }];
  p.services = [{ ...serviceDefaults(), account: 'myservice' }];
  return p;
}
test('old projects migrate additively without changing human accounts', () => {
  const old = defaults(); delete old.services; delete old.serviceAccounts;
  const migrated = normalizeProject(old);
  assert.deepEqual(migrated.users, old.users); assert.deepEqual(migrated.services, []); assert.equal(old.services, undefined);
  assert.equal(validate(old).malformed, undefined);
  assert.ok(validate({ ...old, services: null }).malformed);
  assert.ok(validate({ ...old, serviceAccounts: [{ name: 'app', groups: '', sudo: 'nopasswd' }] }).malformed);
});
test('service accounts cannot satisfy the SSH login check or gain sudo', () => {
  const p = project(); p.users[0].sshKeys = '';
  assert.ok(validate(p).errors.some(e => e.message.includes('no user can log in')));
  p.serviceAccounts[0].groups = 'sudo,docker,disk';
  assert.ok(validate(p).errors.some(e => e.message.includes('hardware groups')));
  p.serviceAccounts[0].name = 'pi';
  assert.ok(validate(p).errors.some(e => e.message.includes('different from login')));
});
test('service accounts export with locked passwords, nologin and explicit SSH denial', () => {
  const p = project(); const files = generate(p).files;
  const hook = files['layer/picreator-project.d/hooks/late/customize99-picreator'].content;
  assert.match(hook, /'useradd' '--system' '--user-group' '--no-create-home' '--home-dir' '\/nonexistent' '--shell' '\/usr\/sbin\/nologin' 'myservice'/);
  assert.match(hook, /'usermod' '--lock' 'myservice'/);
  assert.doesNotMatch(hook, /sudoers.d\/90-picreator-myservice/);
  const written = [...hook.matchAll(/printf '%s' '([^']+)' \| base64 -d/g)].map(m => Buffer.from(m[1], 'base64').toString());
  assert.ok(written.some(s => s.includes('DenyUsers myservice\n')));
  assert.ok(written.some(s => s.includes(p.users[0].sshKeys)));
});
test('units have restricted defaults, literal arguments and hardware-dependent devices', () => {
  const p = project(); p.services[0].arguments = '--title\na value with spaces\n$HOME %n "quoted" \\path';
  let unit = serviceUnit(p.services[0], p.serviceAccounts[0]);
  for (const setting of ['User=myservice', 'Group=myservice', 'NoNewPrivileges=yes', 'ProtectSystem=strict', 'ProtectHome=yes', 'PrivateDevices=yes', 'CapabilityBoundingSet=', 'StateDirectory=myapp', 'StateDirectoryMode=0700']) assert.ok(unit.includes(setting));
  assert.ok(unit.includes('"a value with spaces"')); assert.ok(unit.includes('$$HOME %%n \\"quoted\\" \\\\path'));
  p.serviceAccounts[0].groups = 'i2c,gpio'; p.services[0].network = false;
  unit = serviceUnit(p.services[0], p.serviceAccounts[0]);
  assert.match(unit, /PrivateDevices=no/); assert.match(unit, /PrivateNetwork=yes/); assert.doesNotMatch(unit, /network-online/);
});
test('extra data directories are prepared after mounts and manual-only units remain available', () => {
  const p = project(); p.services[0].writablePaths = '/data/app'; p.services[0].enabled = false;
  const f = generate(p).files;
  assert.match(f['services/myapp.service'].content, /RequiresMountsFor=\/data\/app/);
  assert.match(f['services/myapp.service'].content, /ReadWritePaths=\/data\/app/);
  assert.match(f['services/picreator-dirs-myapp.service'].content, /systemd-tmpfiles --create/);
  assert.equal(f['services/picreator-myapp.conf'].content, 'd /data/app 0700 myservice myservice -\n');
  assert.match(f['layer/picreator-project.d/hooks/late/customize99-picreator'].content, /disable 'myapp.service'/);
});
test('missing accounts, path injection, conflicting permissions and unit overwrites block export', () => {
  const invalid = [
    p => p.services[0].account = 'root',
    p => p.services[0].executable = '+/bin/bash',
    p => p.services[0].description = 'fake\nUser=root',
    p => p.services[0].description = 'trailing\\',
    p => p.services[0].writablePaths = '/etc',
    p => p.services[0].writablePaths = '/data/../etc',
    p => p.services[0].stateDirectory = '../../etc',
    p => p.services[0].name = 'picreator-dirs-evil',
    p => p.software.disableServices = 'myapp.service',
    p => p.advanced.files.push({ path: '/etc/systemd/system/myapp.service', content: 'User=root', executable: false }),
    p => { p.serviceAccounts.push({ name: 'another', groups: '' }); p.services.push({ ...p.services[0], name: 'other', account: 'another' }); }
  ];
  for (const change of invalid) { const p = project(); change(p); assert.ok(validate(p).errors.length, String(change)); assert.throws(() => generate(p)); }
});

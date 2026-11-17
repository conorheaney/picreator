import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, developmentPreset, validate, serviceDefaults, normalizeProject } from '../public/model.js';
import { generate } from '../lib/export.mjs';

const key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB developer';
test('development preset requires root key and assigns all apps to a single restricted account', () => {
  const original = defaults(); original.services.push({ ...serviceDefaults(), account: 'old' });
  const p = developmentPreset(original);
  assert.equal(original.ssh.permitRoot, false);
  assert.deepEqual(p.serviceAccounts, [{ name: 'appsvc', groups: '' }]);
  assert.equal(p.services[0].account, 'appsvc');
  assert.ok(validate(p).errors.some(e => e.message.includes('requires a root public key')));
  p.ssh.rootKeys = key;
  assert.deepEqual(validate(p).errors, []);
  const files = generate(p).files;
  const hook = files['layer/picreator-project.d/hooks/late/customize99-picreator'].content;
  assert.ok(hook.includes('/root/.ssh/authorized_keys'));
  assert.ok(hook.includes("'usermod' '--password' '*' 'root'"));
  const texts = [...hook.matchAll(/printf '%s' '([^']+)' \| base64 -d/g)].map(m => Buffer.from(m[1], 'base64').toString());
  assert.ok(texts.includes(key + '\n'));
  assert.ok(texts.some(t => t.includes('PermitRootLogin prohibit-password\n') && t.includes('DenyUsers appsvc\n')));
  assert.match(files['services/myapp.service'].content, /User=appsvc/);
  p.ssh.permitRoot = false; p.ssh.enabled = false;
  assert.ok(!generate(p).files['layer/picreator-project.d/hooks/late/customize99-picreator'].content.includes('/root/.ssh/authorized_keys'));
});
test('legacy SSH settings migrate and malformed root keys are rejected', () => {
  const old = defaults(); delete old.ssh.rootKeys;
  assert.equal(normalizeProject(old).ssh.rootKeys, '');
  const p = developmentPreset(); p.ssh.rootKeys = '-----BEGIN PRIVATE KEY-----';
  assert.ok(validate(p).errors.some(e => e.message.includes('Root SSH keys must')));
});

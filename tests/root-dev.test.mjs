import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, developmentPreset, validate, serviceDefaults, normalizeProject } from '../public/model.js';
import { generate } from '../lib/export.mjs';

const key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB developer';

test('all human accounts may be deleted while root-only exports retain SSH access', () => {
  const p = defaults(); p.users = [];
  assert.equal(validate(p).malformed, undefined);
  assert.ok(validate(p).errors.some(e => e.message.includes('no user can log in')));
  assert.throws(() => generate(p), /Fix configuration/);
  p.ssh.permitRoot = true; p.ssh.rootKeys = key;
  assert.deepEqual(validate(p).errors, []);
  const files = generate(p).files;
  assert.match(files['config.yaml'].content, /user1: "root"/);
  assert.match(files['config.yaml'].content, /user1groups: "root"/);
  assert.match(files['config.yaml'].content, /user1sudo: "none"/);
  assert.doesNotMatch(files['config.yaml'].content, /user1uid|user1pass|pubkey_user1/);
  assert.equal(files['layer/my-raspberry-pi-settings.d/customize.overlay/root/.ssh/authorized_keys'].content, key + '\n');
  assert.doesNotMatch(files['layer/my-raspberry-pi-settings.d/hooks/late/customize99-my-raspberry-pi'].content, /useradd/);
  p.ssh.permitRoot = false; p.ssh.enabled = false;
  assert.deepEqual(validate(p).errors, []);
  assert.match(generate(p).files['config.yaml'].content, /user1: "root"/);
});
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
  const hook = files['layer/my-raspberry-pi-settings.d/hooks/late/customize99-my-raspberry-pi'].content;
  assert.equal(files['layer/my-raspberry-pi-settings.d/customize.overlay/root/.ssh/authorized_keys'].content, key + '\n');
  assert.ok(hook.includes("'usermod' '--password' '*' 'root'"));
  const ssh = files['layer/my-raspberry-pi-settings.d/customize.overlay/etc/ssh/sshd_config.d/00-my-raspberry-pi-ssh.conf'].content;
  assert.match(ssh, /PermitRootLogin prohibit-password/); assert.match(ssh, /DenyUsers appsvc/);
  assert.match(files['services/myapp.service'].content, /User=appsvc/);
  p.ssh.permitRoot = false; p.ssh.enabled = false;
  assert.ok(!generate(p).files['layer/my-raspberry-pi-settings.d/hooks/late/customize99-my-raspberry-pi'].content.includes('/root/.ssh/authorized_keys'));
});
test('legacy SSH settings migrate and malformed root keys are rejected', () => {
  const old = defaults(); delete old.ssh.rootKeys;
  assert.equal(normalizeProject(old).ssh.rootKeys, '');
  const p = developmentPreset(); p.ssh.rootKeys = '-----BEGIN PRIVATE KEY-----';
  assert.ok(validate(p).errors.some(e => e.message.includes('Root SSH keys must')));
});

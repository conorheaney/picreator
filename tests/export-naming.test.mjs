import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, serviceDefaults, validate } from '../public/model.js';
import { generate } from '../lib/export.mjs';

test('project-based filenames and all internal service/image references remain consistent', () => {
  const p = defaults(); p.project.slug = 'simple-pi'; p.project.name = 'Simple Pi'; p.ssh.enabled = false;
  p.users[0].sshKeys = 'ssh-ed25519 AAAABBBB developer';
  p.storage.table = 'gpt'; p.network.wifi = true; p.network.ssid = 'Lab'; p.network.psk = 'password123'; p.gadget.enabled = true;
  p.serviceAccounts = [{ name:'appsvc', groups:'' }];
  p.services = [{ ...serviceDefaults(), account:'appsvc', writablePaths:'/simple-pi-data' }];
  p.advanced.script = 'echo "picreator is user content"';
  const f = generate(p).files;
  assert.ok(Object.keys(f).every(path => !path.includes('picreator')));
  assert.match(f['config.yaml'].content, /layer: "simple-pi-image"/);
  assert.match(f['config.yaml'].content, /project: "simple-pi-settings"/);
  assert.match(f['config.yaml'].content, /pubkey_user1: "\$\{@SRCROOT\}\/keys\/simple-pi-pi.pub"/);
  assert.match(f['layer/simple-pi-image.yaml'].content, /Name: simple-pi-image/);
  assert.match(f['layer/simple-pi-image.d/hooks/preimage99-layout'].content, /install-fstab.sh/);
  const unit = f['services/myapp.service'].content;
  assert.match(unit, /Requires=simple-pi-prepare-myapp.service/);
  assert.ok(f['services/simple-pi-prepare-myapp.service']);
  assert.match(f['services/simple-pi-prepare-myapp.service'].content, /simple-pi-myapp-directories.conf/);
  assert.ok(f['layer/simple-pi-settings.d/customize.overlay/etc/tmpfiles.d/simple-pi-myapp-directories.conf']);
  const hook = f['layer/simple-pi-settings.d/hooks/late/customize99-simple-pi'].content;
  assert.match(hook, /enable simple-pi-wifi-country.service/);
  assert.ok(f['layer/simple-pi-settings.d/customize.overlay/etc/systemd/system/simple-pi-wifi-country.service']);
  assert.match(f['layer/simple-pi-settings.d/customize.overlay/tmp/simple-pi-customize.sh'].content, /picreator is user content/);
  assert.deepEqual(JSON.parse(f['project.json'].content),p);
});

test('generated executables explain their purpose and bundle README includes project-specific WSL setup first', () => {
  const p = defaults(); p.ssh.enabled = false; p.storage.table = 'gpt'; p.project.slug = 'workbench'; p.advanced.script = 'true';
  const files = generate(p).files;
  for (const [name,f] of Object.entries(files)) if (f.content.startsWith('#!/bin/bash')) {
    assert.ok(f.content.split('\n').filter(line => line.startsWith('# ')).length >= 4, name);
  }
  const readme = files['README.md'].content;
  assert.ok(readme.indexOf('## WSL Ubuntu') < readme.indexOf('## Files'));
  assert.match(readme, /wsl -d rpi-builder -u root --cd \/root/);
  assert.match(readme, /git clone https:\/\/github.com\/raspberrypi\/rpi-image-gen.git/);
  assert.match(readme, /cd \/root\/pi-projects\/workbench/);
  assert.doesNotMatch(readme, /\{\{project\}\}/);
});

test('service names cannot collide with project-owned helpers or exceed archive filename limits', () => {
  const p = defaults(); p.ssh.enabled = false; p.serviceAccounts = [{name:'appsvc',groups:''}];
  p.services = [{...serviceDefaults(),account:'appsvc',name:p.project.slug + '-wifi-country'}];
  assert.ok(validate(p).errors.some(e => e.message.includes('helper services')));
  p.project.slug = 'a'.repeat(48); p.services[0].name = 'b'.repeat(48); p.services[0].writablePaths = '/data/app';
  assert.ok(validate(p).errors.some(e => e.message.includes('100 characters')));
});

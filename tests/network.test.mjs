import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../public/model.js';
import { generate } from '../lib/export.mjs';
const overlay = 'layer/my-raspberry-pi-settings.d/customize.overlay';
test('networking, module configuration and target files export as static layer files', () => {
  const p = defaults(); p.ssh.enabled = false; p.network.ethernet = 'manual'; p.network.address = '192.168.1.50/24'; p.network.gateway = '192.168.1.1';
  p.network.wifi = true; p.network.ssid = ' Lab\\network'; p.network.psk = "a'$(literal)\\pass"; p.gadget.enabled = true;
  const f = generate(p).files;
  const ethernet = f[overlay + '/etc/NetworkManager/system-connections/my-raspberry-pi-ethernet.nmconnection'];
  assert.match(ethernet.content, /address1=192.168.1.50\/24,192.168.1.1/);
  assert.match(ethernet.content, /dns=1.1.1.1;9.9.9.9;/); assert.equal(ethernet.mode, 0o600);
  const wifi = f[overlay + '/etc/NetworkManager/system-connections/my-raspberry-pi-wifi.nmconnection'];
  assert.ok(wifi.content.includes('ssid=\\sLab\\\\network')); assert.ok(wifi.content.includes("psk=a'$(literal)\\\\pass"));
  const usb = f[overlay + '/etc/NetworkManager/system-connections/my-raspberry-pi-usb.nmconnection'].content;
  assert.match(usb, /method=shared/); assert.match(usb, /address1=10.55.0.1\/24/);
  assert.equal(f[overlay + '/etc/modules-load.d/my-raspberry-pi-usb-gadget.conf'].content, 'dwc2\ng_ether\n');
  assert.equal(f[overlay + '/etc/modules-load.d/my-raspberry-pi-usb-gadget.conf'].mode, 0o644);
  // The official Windows driver binds to this VID/PID; retain both configured MACs.
  assert.equal(f[overlay + '/etc/modprobe.d/my-raspberry-pi-usb-gadget.conf'].content,
    `options g_ether idVendor=0x2e8a idProduct=0x0013 dev_addr=${p.gadget.deviceMac} host_addr=${p.gadget.hostMac}\n`);
  assert.doesNotMatch(f['layer/my-raspberry-pi-settings.d/hooks/late/customize99-my-raspberry-pi'].content, /nmcli|base64|config.txt/);
});
test('default Standard layout delegates primary account settings and image geometry upstream', () => {
  const p = defaults(); p.ssh.enabled = false; p.users[0].passwordHash = '$6$salt$hash'; p.users[0].sudo = 'passwd';
  const f = generate(p).files;
  assert.match(f['config.yaml'].content, /layer: "image-rpios"/); assert.match(f['config.yaml'].content, /user1passhash: "\$6\$salt\$hash"/);
  assert.ok(!f['layer/my-raspberry-pi-image.yaml']);
  assert.doesNotMatch(f['layer/my-raspberry-pi-settings.d/hooks/late/customize99-my-raspberry-pi'].content, /chpasswd|useradd|usermod|config.txt|base64/);
});

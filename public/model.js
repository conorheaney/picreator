export function defaults() {
  return {
    schemaVersion: 1,
    project: { name: 'My Raspberry Pi', slug: 'my-raspberry-pi', description: '', version: '1.0.0' },
    system: { hostname: 'raspberrypi', suite: 'trixie-minbase', storage: 'sd', timezone: 'Europe/Dublin', locale: 'en_GB.UTF-8', keyboard: 'gb', keyboardLabel: 'English (UK)' },
    users: [{ name: 'pi', passwordHash: '', sudo: 'none', groups: 'adm,dialout,audio,video,plugdev,input,spi,i2c,gpio,render', uid: '', sshKeys: '' }],
    serviceAccounts: [],
    services: [],
    updates: { strategy: 'standard', systemSize: '8G', dataSize: '4G', shareAppData: true, bundle: 'none' },
    sizing: { fillData: false, capacityGB: '32' },
    ssh: { enabled: true, keyOnly: true, port: 22, permitRoot: false, rootKeys: '' },
    network: { ethernet: 'auto', address: '', gateway: '', dns: '1.1.1.1,9.9.9.9', wifi: false, ssid: '', psk: '', country: 'IE', hidden: false, mdns: true },
    gadget: { enabled: false, mode: 'shared', address: '10.55.0.1/24', deviceMac: '02:00:00:00:00:01', hostMac: '02:00:00:00:00:02' },
    storage: { table: 'mbr', bootSize: '512M', rootSize: '8G', rootFs: 'ext4', diskSignature: 'random', partitions: [] },
    hardware: { i2c: false, spi: false, uart: false, disableBluetooth: false, disableWifi: false, config: '', cmdline: '' },
    software: { packages: 'curl\ngit\nhtop', enableServices: '', disableServices: '' },
    advanced: { layers: '', config: '{}', script: '', files: [] }
  };
}
export const serviceAccountDefaults = () => ({ name: 'myservice', groups: '' });
export const serviceDefaults = () => ({ name: 'myapp', account: '', description: 'My application', executable: '/opt/myapp/bin/server', arguments: '', workingDirectory: '/opt/myapp', stateDirectory: 'myapp', runtimeDirectory: '', writablePaths: '', restart: 'on-failure', enabled: true, network: true });
export const hardwareGroups = ['gpio', 'i2c', 'spi', 'dialout', 'video', 'render', 'audio'];
// Raspberry Pi image-rota: GPT, 8 MiB alignment, fixed order required by tryboot.
export function partitionRows(p) {
  const ab = p.updates.strategy === 'ab';
  let dataSize;
  try { dataSize = p.sizing.fillData ? dataCapacity(p) : p.updates.dataSize; } catch { dataSize = 'Not yet calculated'; }
  const rows = ab ? [
    ['bootconfig', 'BOOTCONFIG', 'vfat', '32M', '/bootfs', 'Boot selection metadata', ''],
    ['boot_a', 'BOOT', 'vfat', p.storage.bootSize, '/boot/firmware (when A active)', 'Slot A boot files', 'boot'],
    ['boot_b', 'BOOT', 'vfat', p.storage.bootSize, '/boot/firmware (when B active)', 'Slot B boot files', 'boot'],
    ['system_a', 'SYSTEM', 'erofs', p.updates.systemSize, '/ (when A active)', 'Slot A read-only system', 'system'],
    ['system_b', 'SYSTEM', 'erofs', p.updates.systemSize, '/ (when B active)', 'Slot B read-only system', 'system'],
    ['persistent', 'PERSISTENT', 'ext4', dataSize, '/persistent', 'Shared writable data', 'persistent']
  ] : [
    ['boot', 'BOOT', 'vfat', p.storage.bootSize, '/boot/firmware', 'Firmware and kernel', 'boot'],
    ['root', 'ROOT', p.storage.rootFs, p.storage.rootSize, '/', 'Operating system', 'root'],
    ...p.storage.partitions.map((d, i) => ['data' + i, d.label, 'ext4', p.sizing.fillData && i === p.storage.partitions.length - 1 ? dataSize : d.size, d.mount, 'Application data', 'data:' + i])
  ];
  return rows.map(([name, label, filesystem, size, mount, purpose, edit], i) => ({ number: i + 1, name, label, filesystem, size, mount, purpose, edit }));
}
export function dataCapacity(p) {
  const mib = value => {
    if (!/^[1-9][0-9]*[MG]$/.test(value)) throw new Error('Use absolute M/G sizes for boot, system and other partitions when filling data space.');
    return Number(value.slice(0, -1)) * (value.endsWith('G') ? 1024 : 1);
  };
  if (!/^[0-9]+(?:\.[0-9]{1,3})?$/.test(p.sizing.capacityGB) || +p.sizing.capacityGB <= 0 || +p.sizing.capacityGB > 16000) throw new Error('Enter a target capacity in decimal GB, greater than zero and at most 16000.');
  const total = Math.floor(Number(p.sizing.capacityGB) * 1e9 / 1048576);
  const ab = p.updates.strategy === 'ab';
  if (!ab && !p.storage.partitions.length) throw new Error('Add a data partition first. The last data partition will use the remaining space.');
  const used = ab ? 2 * mib(p.storage.bootSize) + 2 * mib(p.updates.systemSize) : mib(p.storage.bootSize) + mib(p.storage.rootSize) + p.storage.partitions.slice(0, -1).reduce((n, d) => n + mib(d.size), 0);
  const remaining = total - used - 64;
  if (remaining < 64) throw new Error('Target capacity is too small: allow at least 64 MiB of data after system partitions and the 64 MiB layout reserve.');
  return remaining + 'M';
}
export function developmentPreset(p = defaults()) {
  const result = structuredClone(normalizeProject(p));
  result.ssh = { ...result.ssh, enabled: true, keyOnly: true, permitRoot: true };
  result.serviceAccounts = [{ name: 'appsvc', groups: '' }];
  result.services = result.services.map(s => ({ ...s, account: 'appsvc' }));
  return result;
}
// Additive schema-1 migration: preserve every existing setting and reject malformed new fields.
export function normalizeProject(p) {
  if (!p || p.schemaVersion !== 1) return p;
  return { ...p, ...(!Object.hasOwn(p, 'sizing') ? { sizing: defaults().sizing } : {}), ...(!Object.hasOwn(p, 'updates') ? { updates: defaults().updates } : {}), ...(p.ssh && typeof p.ssh === 'object' && !Array.isArray(p.ssh) ? { ssh: { ...p.ssh, ...(!Object.hasOwn(p.ssh, 'rootKeys') ? { rootKeys: '' } : {}) } } : {}), ...(!Object.hasOwn(p, 'serviceAccounts') ? { serviceAccounts: [] } : {}), ...(!Object.hasOwn(p, 'services') ? { services: [] } : {}) };
}
export const lines = value => String(value || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
export const words = value => String(value || '').split(/[\s,]+/).filter(Boolean);
export const isIPv4 = value => /^(\d{1,3}\.){3}\d{1,3}$/.test(value) && value.split('.').every(x => +x <= 255);
export const isCIDR = value => typeof value === 'string' && isIPv4(value.split('/')[0]) && /^(?:[1-9]|[12][0-9]|3[0-2])$/.test(value.split('/')[1] || '');
export function validate(p) {
  p = normalizeProject(p);
  const errors = [], warnings = [];
  const e = (section, message) => errors.push({ section, message });
  const w = (section, message) => warnings.push({ section, message });
  if (!p || p.schemaVersion !== 1) return { errors: [{ section: 'overview', message: 'Unsupported project schema. Expected schemaVersion 1.' }], warnings, malformed: true };
  for (const key of ['project', 'system', 'ssh', 'network', 'gadget', 'storage', 'hardware', 'software', 'advanced']) {
    if (!p[key] || typeof p[key] !== 'object' || Array.isArray(p[key])) e('overview', `Missing or invalid ${key} settings.`);
  }
  if (!Array.isArray(p.users) || !p.users.length) e('users', 'At least one user is required.');
  if (errors.length) return { errors, warnings, malformed: true };
  // Validate the complete schema before interpreting imported settings.
  function shape(value, sample, path) {
    if (Array.isArray(sample)) return;
    if (typeof sample === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) { e('overview', `Invalid ${path}.`); return; }
      for (const k of Object.keys(sample)) shape(value[k], sample[k], `${path}.${k}`);
      for (const k of Object.keys(value)) if (!(k in sample)) e('overview', `Unknown setting ${path}.${k}.`);
    } else if (typeof value !== typeof sample) e('overview', `Invalid type for ${path}.`);
  }
  shape(p, defaults(), 'project');
  p.users.forEach((u, i) => shape(u, defaults().users[0], `users.${i}`));
  if (!Array.isArray(p.storage.partitions) || !Array.isArray(p.advanced.files)) e('storage', 'Partitions and files must be lists.');
  if (errors.length) return { errors, warnings, malformed: true };
  p.storage.partitions.forEach((d, i) => shape(d, { label: '', size: '', mount: '' }, `partitions.${i}`));
  p.advanced.files.forEach((f, i) => shape(f, { path: '', content: '', executable: false }, `files.${i}`));
  if (!Array.isArray(p.serviceAccounts) || !Array.isArray(p.services)) e('services', 'Service accounts and services must be lists.');
  else {
    p.serviceAccounts.forEach((a, i) => shape(a, serviceAccountDefaults(), `serviceAccounts.${i}`));
    p.services.forEach((s, i) => shape(s, serviceDefaults(), `services.${i}`));
  }
  if (errors.length) return { errors, warnings, malformed: true };
  if (p.sizing.fillData) { try { dataCapacity(p); } catch (error) { e('storage', error.message); } }
  if (!['standard', 'ab'].includes(p.updates.strategy)) e('storage', 'Select Standard image or Field updates (A/B).');
  if (!['none', 'otamaker'].includes(p.updates.bundle)) e('storage', 'Invalid update bundle format.');
  if (p.updates.strategy === 'ab') {
    if (!/^[1-9][0-9]*[MG]$/.test(p.updates.systemSize) || !/^[1-9][0-9]*[MG]$/.test(p.updates.dataSize)) e('storage', 'A/B system and data sizes must be absolute sizes such as 8G or 512M.');
    w('storage', 'A/B builds use an immutable root. Updates require a separately integrated deployment client, signed release delivery, health checks and tryboot confirmation; choosing this layout does not enable automatic updates.');
    if (p.storage.partitions.length) w('storage', 'Standard image data partitions are retained in the project but not used in A/B mode.');
    if (p.services.some(s => s.writablePaths.trim())) e('services', 'For A/B images use service persistent data directories under /var/lib; extra writable paths under /data, /srv or /mnt are not supported.');
    if (!p.updates.shareAppData && p.services.some(s => s.stateDirectory)) w('storage', 'Application state under /var/lib is slot-local. It may reset or differ after switching slots.');
    if (p.updates.shareAppData && p.services.some(s => s.stateDirectory)) w('storage', 'Shared application data survives slot changes. Database migrations must remain compatible with the previous release for rollback. Keep account UIDs/GIDs stable across releases.');
    for (const section of ['image']) {
      try { if (Object.keys(JSON.parse(p.advanced.config)[section] || {}).length) e('advanced', 'Image overrides are not allowed in A/B mode; use the guided image strategy settings.'); } catch {}
    }
  }
  if (!p.project.name.trim()) e('overview', 'Give your project a name.');
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(p.project.slug)) e('overview', 'Folder name must start with a lowercase letter and contain only lowercase letters, numbers, or hyphens (up to 48 characters).');
  if (!/^[a-zA-Z0-9._-]{1,40}$/.test(p.project.version)) e('overview', 'Version must contain only letters, numbers, dots, underscores, or hyphens.');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p.system.hostname)) e('system', 'Hostname must be 1–63 lowercase letters, numbers, or hyphens; no hyphen at either end.');
  if (!['trixie-minbase', 'bookworm-minbase'].includes(p.system.suite)) e('system', 'Select a supported base system.');
  if (!['sd', 'nvme'].includes(p.system.storage)) e('system', 'Select SD or NVMe storage.');
  try { new Intl.DateTimeFormat('en', { timeZone: p.system.timezone }); } catch { e('system', 'Enter a valid IANA timezone, such as Europe/Dublin.'); }
  if (!/^[a-z]{2}_[A-Z]{2}\.UTF-8$/.test(p.system.locale)) e('system', 'Use a UTF-8 locale such as en_GB.UTF-8.');
  if (!/^[a-z0-9_-]+$/.test(p.system.keyboard) || !p.system.keyboardLabel.trim()) e('system', 'Set a keyboard code and label.');
  const names = new Set(), uids = new Set();
  p.users.forEach((u, i) => {
    const label = `User ${i + 1}`;
    if (!/^[a-z_][a-z0-9_-]{0,30}$/.test(u.name) || ['root', 'daemon', 'nobody', 'www-data', 'systemd-network'].includes(u.name)) e('users', `${label}: choose a valid, non-system Linux username.`);
    if (names.has(u.name)) e('users', 'Usernames must be unique.');
    names.add(u.name);
    if (u.uid && (!/^\d+$/.test(u.uid) || +u.uid < 1000 || +u.uid > 65533 || uids.has(u.uid))) e('users', `${label}: UID must be unique and between 1000 and 65533.`);
    if (u.uid) uids.add(u.uid);
    if (!['none', 'passwd', 'nopasswd'].includes(u.sudo)) e('users', `${label}: invalid sudo setting.`);
    if (u.sudo === 'passwd' && !u.passwordHash) e('users', `${label}: password-protected sudo needs a password hash.`);
    if (u.sudo === 'nopasswd') w('users', `${u.name} can use sudo without a password.`);
    if (u.passwordHash && !/^\$(?:6|y)\$[a-zA-Z0-9./$]+$/.test(u.passwordHash)) e('users', `${label}: use a SHA-512 ($6$) or yescrypt ($y$) password hash, not a plaintext password.`);
    if (words(u.groups).some(g => !/^[a-z_][a-z0-9_-]*$/.test(g) || g === 'sudo')) e('users', `${label}: invalid group, or sudo group specified. Use the sudo selector instead.`);
    if (lines(u.sshKeys).some(k => !/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh.com|sk-ecdsa-sha2-nistp256@openssh.com) [A-Za-z0-9+/]+={0,3}(?: .*)?$/.test(k))) e('users', `${label}: enter one OpenSSH public key per line.`);
    if (!u.passwordHash && !u.sshKeys.trim()) w('users', `${u.name} has no login credential. Set a password hash or SSH public key.`);
  });
  if (p.ssh.enabled && !(p.ssh.permitRoot && p.ssh.rootKeys.trim()) && !p.users.some(u => u.sshKeys.trim() || (!p.ssh.keyOnly && u.passwordHash))) e('users', 'SSH is enabled but no user can log in. Add a public key, or enable password login and set a password hash.');
  if (lines(p.ssh.rootKeys).some(k => !/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh.com|sk-ecdsa-sha2-nistp256@openssh.com) [A-Za-z0-9+/]+={0,3}(?: .*)?$/.test(k))) e('users', 'Root SSH keys must be OpenSSH public keys, one per line.');
  if (p.ssh.permitRoot && !p.ssh.rootKeys.trim()) e('users', 'Root SSH access requires a root public key.');
  const accounts = new Set();
  for (const a of p.serviceAccounts) {
    if (!/^[a-z_][a-z0-9_-]{0,30}$/.test(a.name) || ['root', 'daemon', 'nobody', 'www-data', 'systemd-network', 'bin', 'sys', 'sync', 'mail', 'backup', 'proxy', 'sshd'].includes(a.name)) e('users', 'Choose a non-system Linux name for each service account.');
    if (names.has(a.name) || accounts.has(a.name)) e('users', 'Service account names must be unique and different from login accounts.');
    accounts.add(a.name);
    if (words(a.groups).some(g => !hardwareGroups.includes(g))) e('users', 'Service accounts may only use the listed hardware groups; sudo, docker and other privileged groups are not allowed.');
  }
  const serviceNames = new Set(), ownedPaths = [];
  const absolute = value => /^\/[a-zA-Z0-9_./-]+$/.test(value) && !value.slice(1).split('/').some(x => x === '.' || x === '..' || x === '');
  for (const s of p.services) {
    if (!/^[a-z][a-z0-9_-]{0,47}$/.test(s.name) || s.name.startsWith('picreator-') || ['ssh', 'sshd', 'systemd', 'dbus', 'getty', 'sudo', 'avahi-daemon'].includes(s.name)) e('services', 'Service names must be unique lowercase names without .service, and must not replace system services or use the picreator- prefix.');
    if (serviceNames.has(s.name)) e('services', 'Service names must be unique.');
    serviceNames.add(s.name);
    if (!accounts.has(s.account)) e('services', `${s.name}: select an existing restricted service account.`);
    if (!absolute(s.executable)) e('services', `${s.name}: executable must be an absolute path without spaces or dot segments.`);
    if (s.workingDirectory && !absolute(s.workingDirectory)) e('services', `${s.name}: working directory must be an absolute path without spaces or dot segments.`);
    if (/[\\\x00-\x1f\x7f]/.test(s.description) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s.arguments)) e('services', `${s.name}: invalid control characters or backslashes in description, or invalid argument characters.`);
    if (!['no', 'on-failure', 'always'].includes(s.restart)) e('services', `${s.name}: invalid restart policy.`);
    for (const [key, prefix] of [['stateDirectory', '/var/lib/'], ['runtimeDirectory', '/run/']]) {
      if (s[key] && !/^[a-z][a-z0-9_-]{0,47}$/.test(s[key])) e('services', `${s.name}: directory names must be lowercase names, not paths.`);
      if (s[key]) ownedPaths.push({ path: prefix + s[key], account: s.account });
    }
    for (const path of lines(s.writablePaths)) {
      if (!/^\/(data|srv|mnt)\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(path)) e('services', `${s.name}: extra writable directories must be beneath /data, /srv or /mnt without spaces or dot segments.`);
      ownedPaths.push({ path, account: s.account });
      if (p.storage.partitions.some(d => d.mount === path || path.startsWith(d.mount + '/'))) w('services', `${s.name}: writable data directories are created after mounted filesystems are available at boot.`);
    }
    if (words(p.software.disableServices).includes(s.name + '.service')) e('services', `${s.name}: remove this guided service from the mask list.`);
    if (words(p.software.enableServices).includes(s.name + '.service')) e('services', `${s.name}: use its Start at boot setting instead of the separate enable list.`);
    if (p.advanced.files.some(f => f.path === `/etc/systemd/system/${s.name}.service` || f.path.startsWith(`/etc/systemd/system/${s.name}.service.d/`))) e('services', `${s.name}: an advanced file conflicts with the guided service unit.`);
  }
  for (let i = 0; i < ownedPaths.length; i++) for (let j = i + 1; j < ownedPaths.length; j++) {
    const a = ownedPaths[i], b = ownedPaths[j];
    if (a.account !== b.account && (a.path === b.path || a.path.startsWith(b.path + '/') || b.path.startsWith(a.path + '/'))) e('services', 'Writable directories belonging to different service accounts must not overlap.');
  }
  if (!Number.isInteger(p.ssh.port) || p.ssh.port < 1 || p.ssh.port > 65535) e('users', 'SSH port must be between 1 and 65535.');
  if (p.ssh.permitRoot) w('users', 'Root SSH access grants full administration. Intended for development/provisioning; disable it for production.');
  if (!['auto', 'manual', 'disabled'].includes(p.network.ethernet)) e('network', 'Invalid Ethernet mode.');
  if (p.network.ethernet === 'manual') {
    if (!isCIDR(p.network.address)) e('network', 'Static Ethernet address must be IPv4/CIDR, for example 192.168.1.50/24.');
    if (p.network.gateway && !isIPv4(p.network.gateway)) e('network', 'Enter a valid IPv4 gateway.');
    if (words(p.network.dns).some(x => !isIPv4(x))) e('network', 'DNS servers must be IPv4 addresses separated by commas.');
  }
  if (!/^[A-Z]{2}$/.test(p.network.country)) e('network', 'Wi-Fi country must be a two-letter uppercase country code.');
  if (p.network.wifi) {
    if (!p.network.ssid || new TextEncoder().encode(p.network.ssid).length > 32 || /[\r\n\0]/.test(p.network.ssid)) e('network', 'Wi-Fi SSID must be 1–32 bytes with no line breaks.');
    if (!(p.network.psk.length >= 8 && p.network.psk.length <= 63 && !/[\r\n\0]/.test(p.network.psk)) && !/^[a-fA-F0-9]{64}$/.test(p.network.psk)) e('network', 'Wi-Fi password must be 8–63 characters, or a 64-digit hexadecimal PSK.');
    w('network', 'Wi-Fi credentials are stored in the project and exported files. Keep these files private.');
    if (p.hardware.disableWifi) e('network', 'Wi-Fi cannot be configured while its hardware is disabled.');
  }
  if (!['shared', 'auto', 'manual'].includes(p.gadget.mode)) e('gadget', 'Invalid USB network mode.');
  if (p.gadget.enabled) {
    if (p.gadget.mode !== 'auto' && !isCIDR(p.gadget.address)) e('gadget', 'USB address must be IPv4/CIDR.');
    const mac = /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$/;
    for (const k of ['deviceMac', 'hostMac']) if (!mac.test(p.gadget[k]) || (parseInt(p.gadget[k].slice(0, 2), 16) & 3) !== 2) e('gadget', 'Use locally administered, unicast MAC addresses beginning with 02, 06, 0a, or 0e.');
    if (p.gadget.deviceMac.toLowerCase() === p.gadget.hostMac.toLowerCase()) e('gadget', 'Device and host MAC addresses must differ.');
    w('gadget', 'Use the Pi 5 USB-C data port and adequate power. Windows may need an RNDIS driver. Validate gadget operation on your hardware.');
  }
  if (p.updates.strategy === 'standard') {
  const size = /^[1-9][0-9]*(M|G|%)$/;
  if (!size.test(p.storage.bootSize) || !size.test(p.storage.rootSize)) e('storage', 'Partition sizes must be positive M, G, or % values, such as 512M, 8G, or 300%.');
  if (!['mbr', 'gpt'].includes(p.storage.table) || !['ext4', 'btrfs'].includes(p.storage.rootFs)) e('storage', 'Invalid partition table or root filesystem.');
  if (!/^(random|0x(?!00000000)[a-fA-F0-9]{8})$/.test(p.storage.diskSignature)) e('storage', 'Disk signature must be random or a nonzero 8-digit hex number prefixed with 0x.');
  if (p.storage.table === 'mbr' && p.storage.partitions.length > 2) e('storage', 'MBR allows at most two additional data partitions (four partitions total).');
  if (p.storage.partitions.length > 16) e('storage', 'At most 16 data partitions are supported.');
  const labels = new Set(['BOOT', 'ROOT']), mounts = new Set();
  p.storage.partitions.forEach((d, i) => {
    if (!d || typeof d !== 'object') { e('storage', `Invalid partition ${i + 3}.`); return; }
    if (!/^[A-Z][A-Z0-9_]{0,15}$/.test(d.label) || labels.has(d.label)) e('storage', 'Data labels must be unique uppercase names, up to 16 characters.');
    labels.add(d.label);
    if (!/^[1-9][0-9]*[MG]$/.test(d.size)) e('storage', 'Data partitions need an absolute size such as 1G.');
    if (!/^\/(?:data|srv|mnt)\/[a-zA-Z0-9_-]+$/.test(d.mount) || mounts.has(d.mount)) e('storage', 'Each data mount must be unique and beneath /data/, /srv/, or /mnt/.');
    mounts.add(d.mount);
  });
  if (p.storage.table === 'gpt' || p.storage.partitions.length) w('storage', 'Custom layouts adapt the installed image-rpios template. Provisioning metadata is disabled. Verify the layout and boot on a spare device before deployment.');
  } else if (!/^[1-9][0-9]*[MG]$/.test(p.storage.bootSize)) e('storage', 'A/B boot size must be an absolute size such as 512M.');
  if (words(p.software.packages).some(x => !/^[a-z0-9][a-z0-9+.-]*(?::arm64)?(?:=[a-zA-Z0-9.+:~_-]+)?$/.test(x))) e('software', 'Use Debian package names, optionally with =version, separated by spaces or lines.');
  for (const k of ['enableServices', 'disableServices']) if (words(p.software[k]).some(x => !/^[a-zA-Z0-9_][a-zA-Z0-9_.@-]*\.(service|timer|socket)$/.test(x))) e('software', 'Service names must end in .service, .timer, or .socket.');
  if (words(p.software.enableServices).some(x => words(p.software.disableServices).includes(x))) e('software', 'A service cannot be both enabled and disabled.');
  if (lines(p.advanced.layers).some(x => !/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/.test(x))) e('advanced', 'Additional layers must be layer names, one per line.');
  try {
    const v = JSON.parse(p.advanced.config);
    if (!v || Array.isArray(v) || typeof v !== 'object') throw new Error();
    for (const [section, values] of Object.entries(v)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(section) || ['include', 'env', 'layer', 'packages', 'trait'].includes(section) || !values || Array.isArray(values) || typeof values !== 'object') throw new Error();
      for (const [key, val] of Object.entries(values)) if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) || !['string', 'boolean', 'number'].includes(typeof val)) throw new Error();
    }
    if (Object.keys(v).length) w('advanced', 'Advanced configuration overrides guided settings. Review the resulting config.yaml.');
  } catch { e('advanced', 'Overrides must be a JSON object of sections containing scalar settings. include/env/layer/packages/trait are not allowed here.'); }
  const paths = new Set();
  p.advanced.files.forEach(f => {
    if (!f || typeof f.path !== 'string' || typeof f.content !== 'string' || typeof f.executable !== 'boolean' || !/^\/(etc|opt|usr\/local|var\/lib)\/[a-zA-Z0-9_./-]+$/.test(f.path) || f.path.split('/').some(x => x === '..' || x === '.') || paths.has(f.path)) e('advanced', 'Overlay paths must be unique absolute file paths beneath /etc, /opt, /usr/local, or /var/lib, without dot segments.');
    if (f) paths.add(f.path);
  });
  if (p.advanced.script.trim()) w('advanced', 'Your custom script runs as root inside the target filesystem during the WSL build. Review it before executing.');
  // Guided values never opt into rpi-image-gen shell expansion.
  for (const [k, v] of Object.entries(p.system)) if (/\$[({]|`|[\r\n]/.test(String(v))) e('system', `${k} cannot contain shell expressions or line breaks.`);
  if (/[\r\n]/.test(p.hardware.cmdline)) e('hardware', 'Kernel arguments must be a single line.');
  return { errors, warnings };
}

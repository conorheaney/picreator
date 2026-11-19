import { defaults, validate, normalizeProject, serviceDefaults, serviceAccountDefaults, hardwareGroups, words, dataCapacity, partitionRows } from './model.js';
let project = defaults(), id = null, revision = 0, dirty = false, section = 'overview', preview = null, activeFile = 'config.yaml', busy = false;
const sections = [
  // Service accounts live beside human accounts; service definitions have their own page.
  ['overview', 'Overview', '▦', 'Your image starts here', 'Give your project an identity, then make it your own.'],
  ['system', 'System & locale', '◈', 'A solid foundation', 'Choose your base system, device identity, and regional settings.'],
  ['users', 'Users & access', '♙', 'Make yourself at home', 'Create accounts and decide how you will connect to your Raspberry Pi.'],
  ['network', 'Networking', '⌘', 'Get connected', 'Set up Ethernet, Wi-Fi, and local device discovery.'],
  ['storage', 'Storage & partitions', '▤', 'Room for your system', 'Shape the disk layout and leave space for applications and data.'],
  ['gadget', 'USB Ethernet gadget', '♧', 'One cable. A direct connection.', 'Turn the USB-C port into a network link to your computer.'],
  ['hardware', 'Hardware & boot', '⚙', 'Connect to the real world', 'Enable hardware interfaces and customise firmware and kernel settings.'],
  ['software', 'Packages & services', '◇', 'Bring your tools along', 'Install software and control which services start with your Pi.'],
  ['services', 'Application services', '▷', 'Your applications, with boundaries', 'Run your services as restricted accounts while keeping SSH available for development.'],
  ['advanced', 'Layers & scripts', '⌨', 'Go beyond the defaults', 'Extend your image with upstream layers, files, and custom build steps.'],
  ['export', 'Review & export', '↗', 'Ready for the build bench', 'Review your configuration, inspect the generated files, and take them to WSL.']
];
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function get(path) { if (path.startsWith('partition.')) return partitionDraft.value[path.slice(10)]; if (path.startsWith('draft.')) return accountDraft.value[path.slice(6)]; return path.split('.').reduce((o, k) => o[k], project); }
function set(path, value) { if (path.startsWith('partition.')) { partitionDraft.value[path.slice(10)] = value; return; } if (path.startsWith('draft.')) { accountDraft.value[path.slice(6)] = value; return; } const keys = path.split('.'), key = keys.pop(); keys.reduce((o, k) => o[k], project)[key] = value; }
const help = text => `<span class="help" tabindex="0" title="${esc(text)}" aria-label="${esc(text)}">?</span>`;
function field(path, label, hint = label, type = 'text', options = []) {
  const value = get(path), attrs = `data-path="${path}" id="f-${path}" aria-description="${esc(hint || label)}"`;
  const input = type === 'select' ? `<select ${attrs}>${options.map(o => { const [v, text] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(text)}</option>`; }).join('')}</select>` : type === 'textarea' || type === 'code' ? `<textarea ${attrs} class="${type === 'code' ? 'code' : ''}" spellcheck="false">${esc(value)}</textarea>` : `<input ${attrs} type="${type}" value="${esc(value)}" ${type === 'password' ? 'autocomplete="new-password"' : ''}>`;
  return `<label class="field" for="f-${path}"><span>${esc(label)} ${help(hint || label)}</span>${input}</label>`;
}
const toggle = (path, title, description) => `<label class="toggle-row"><span><b>${esc(title)}</b> ${help(description)}</span><input type="checkbox" data-path="${path}" ${get(path) ? 'checked' : ''} aria-label="${esc(title)}" aria-description="${esc(description)}"></label>`;
const card = (title, subtitle, body, tag = '', actions = '') => `<section class="card"><div class="card-head"><div class="card-title"><h2>${title}</h2>${subtitle ? help(subtitle) : ''}</div>${tag ? `<span class="tag">${tag}</span>` : ''}${actions ? `<div class="card-actions">${actions}</div>` : ''}</div><div class="card-body">${body}</div></section>`;
const note = (text, kind = '') => `<div class="note ${kind}">${text}</div>`;
const columns = (body, aside) => `<div class="grid"><div>${body}</div><aside class="right-column">${aside}</aside></div>`;
const tip = (title, body) => card(title, '', `<div class="help-box">${body}</div>`);
function usbNetworkGuide() {
  return tip('USB connection guide', `
    <h3>Shared: a fixed address for your app</h3>
    <p>The Pi keeps the USB address you configure and automatically gives your computer a compatible address. This is a good choice for serving a web app or API directly over USB.</p>
    <p>With the default settings, open <code>http://10.55.0.1:8080</code> for an app on port 8080. Use your configured Pi address and application port. Your server must listen on the USB address or <code>0.0.0.0</code>, rather than only <code>127.0.0.1</code>.</p>
    <h3>Internet access and Windows ICS</h3>
    <p>In Shared mode, leave Windows Internet Connection Sharing (ICS) off for this USB adapter. The Pi supplies addresses; enabling ICS would make Windows try to do the same. The Pi can still get internet through its own Wi-Fi or Ethernet connection.</p>
    <p>To give the Pi internet through your computer instead, choose <b>DHCP client</b>. In Windows, enable ICS on your internet-connected Wi-Fi or Ethernet adapter and select the Pi USB adapter as the connection to share with. Windows assigns the Pi an address, which can change. Find that address before opening your app, API or SSH connection.</p>
    <details><summary>When to use Manual mode</summary>
      <p>Manual mode fixes the Pi address but does not give your computer an address automatically. Configure the Windows USB adapter yourself. For example: Pi <code>10.55.0.1/24</code>, Windows <code>10.55.0.2</code> with subnet mask <code>255.255.255.0</code>. Leave the Windows gateway and DNS blank for a local-only link. Shared mode avoids this manual setup.</p>
    </details>
    <details><summary>What the two MAC addresses mean</summary>
      <p>USB creates a virtual network adapter at each end. The Pi MAC identifies the Pi end; the Host MAC identifies the adapter that appears in Windows. Both are supplied by the Pi. They do not need to match the physical Ethernet or Wi-Fi adapters on either device.</p>
      <p>For one Pi, keep the defaults. These identify adapters; use the Pi IP address, not a MAC address, in browser URLs and SSH commands.</p>
    </details>
    <details><summary>Connecting more than one Pi</summary>
      <p>Give each Pi a unique MAC pair and, in Shared or Manual mode, a different USB subnet. For example: first Pi <code>10.55.0.1/24</code> with MACs ending <code>:01</code> and <code>:02</code>; second Pi <code>10.56.0.1/24</code> with MACs ending <code>:03</code> and <code>:04</code>. Keep the other MAC bytes as configured. Changing MACs alone does not resolve overlapping IP networks.</p>
    </details>
    <details><summary>Cable, driver and connection checks</summary>
      <p>Use a data-capable cable connected to the Pi 5 USB-C port and ensure sufficient power. On Windows, install the official Raspberry Pi RNDIS driver if the adapter is not recognised. A Device Manager warning indicates a device or driver problem; a No Internet status alone does not prevent local SSH or web access.</p>
      <p>Enable SSH under Users &amp; access and use an account with a configured key or password. Connect to the Pi USB IP address, or try its unique <code>hostname.local</code> when mDNS is enabled and supported by the computer.</p>
    </details>
    <h3>Your selected mode stays fixed</h3>
    <p>This editor does not change modes when you connect another computer. The optional official rpi-usb-gadget service can detect host internet sharing and switch between client and shared modes; that service is not installed by this editor. Keeping Shared mode fixed makes the Pi address predictable for your app and API.</p>
    <p><a href="https://github.com/raspberrypi/rpi-usb-gadget" target="_blank" rel="noreferrer">Official USB gadget and Windows driver guide ↗</a></p>
  `);
}
const next = s => `<button data-nav="${s}">Continue to ${sections.find(x => x[0] === s)[1]} →</button>`;
let accountDraft = null, deletion = null, partitionDraft = null;
function accountIcon(kind) {
  const paths = {
    root: '<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    users: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    serviceAccounts: '<path d="m9 3-.5 2-2 1-2-.5-2 3 1.5 1.5v3L2.5 14.5l2 3 2-.5 2 1 .5 3h6l.5-3 2-1 2 .5 2-3-1.5-1.5v-3L21.5 8.5l-2-3-2 .5-2-1-.5-2z"/><circle cx="12" cy="12" r="3"/>'
  };
  return `<span class="account-icon account-icon-${kind}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[kind]}</svg></span>`;
}
function accountTable() {
  const row = (name, type, login, access, edit, remove = '', kind = 'users') => `<tr><td><span class="account-name">${accountIcon(kind)}<strong>${esc(name)}</strong></span></td><td>${type}</td><td>${login}</td><td>${access}</td><td class="table-actions">${edit}${remove}</td></tr>`;
  const edit = (kind, index) => `<button class="small" data-edit-kind="${kind}" data-index="${index}">Edit<span class="sr-only"> ${esc(kind === 'root' ? 'root' : project[kind][index].name)}</span></button>`;
  const remove = (kind, index) => `<button class="small danger" data-delete-kind="${kind}" data-index="${index}">Delete<span class="sr-only"> ${esc(project[kind][index].name)}</span></button>`;
  return card('Accounts', 'Manage login users, restricted application accounts and root access.', `<div class="table-scroll"><table class="accounts-table"><thead><tr><th>Account</th><th>Type</th><th>SSH / login</th><th>Privileges</th><th>Actions</th></tr></thead><tbody>${row('root', 'System administrator', project.ssh.enabled && project.ssh.permitRoot ? 'SSH key access' : 'Root SSH disabled', 'Full administrator', edit('root', 0), '', 'root')}${project.users.map((u,i) => row(u.name, i === 0 ? 'Primary login' : 'Login account', u.sshKeys.trim() ? 'Public key configured' : u.passwordHash ? 'Password configured' : 'No credentials', esc(u.sudo === 'none' ? 'Standard user' : u.sudo === 'passwd' ? 'Sudo with password' : 'Passwordless sudo'), edit('users',i), remove('users',i))).join('')}${project.serviceAccounts.map((a,i) => row(a.name, 'Service account', 'No login / SSH', 'No sudo' + (a.groups ? ' ? ' + esc(a.groups) : ''), edit('serviceAccounts',i), remove('serviceAccounts',i), 'serviceAccounts')).join('')}</tbody></table></div>`, '', '<button data-action="add-user">+ Login account</button><button data-action="add-account">+ Service account</button>');
}
function openAccount(kind, index = -1) {
  const value = kind === 'root' ? structuredClone(project.ssh) : index >= 0 ? structuredClone(project[kind][index]) : kind === 'users' ? { ...defaults().users[0], name: '', groups: 'users' } : { ...serviceAccountDefaults(), name: '' };
  accountDraft = { kind, index, value };
  const f = (key, label, hint, type = 'text', options = []) => field('draft.' + key, label, hint, type, options);
  const body = kind === 'root' ? toggle('draft.permitRoot', 'Allow root SSH with a key', 'Full administration for development/provisioning. Root password SSH is disabled.') + '<br>' + f('rootKeys', 'Root SSH public keys', 'One public key per line. Each developer should keep their own private key.', 'code') : f('name', 'Account name', 'Unique lowercase Linux username.') + (kind === 'users' ? `<div class="field-grid">${f('uid','User ID (optional)','Blank assigns automatically; otherwise 1000?65533.')}${f('sudo','Administrator access','Password mode requires a password hash.','select',[['none','Standard user'],['passwd','Sudo ? password required'],['nopasswd','Sudo ? no password']])}</div><br>${f('groups','Additional groups','Comma-separated Linux groups; configure sudo with the selector.')}${f('passwordHash','Password hash','Generate with openssl passwd -6 in WSL. Blank disables password login.','password')}${f('sshKeys','SSH public keys','One public key per line; never paste a private key.','code')}` : note('System UID assigned automatically. Password locked, shell nologin, no home directory, no SSH and no sudo.') + '<h3>Hardware access</h3><div class="hardware-groups">' + hardwareGroups.map(g => `<label><input type="checkbox" data-draft-group="${g}" ${words(value.groups).includes(g) ? 'checked' : ''}> ${esc(g)} ${help('Allow access to devices in the ' + g + ' group. Enable the hardware interface separately.')}</label>`).join('') + '</div>');
  dialog(`<div id="account-errors" role="alert"></div>${body}<div class="dialog-actions"><button class="primary" data-action="save-account">Save account</button><button data-action="close-dialog">Cancel</button></div>`, `<h2 id="account-dialog-title" class="account-dialog-title">${accountIcon(kind)}${kind === 'root' ? 'Root SSH access' : (index < 0 ? 'Add ' : 'Edit ') + (kind === 'users' ? 'login account' : 'service account')}</h2>`);
}
function saveAccount() {
  const { kind, index, value } = accountDraft, candidate = structuredClone(project);
  if (kind === 'root') candidate.ssh = value;
  else if (index < 0) candidate[kind].push(value);
  else {
    candidate[kind][index] = value;
    if (kind === 'serviceAccounts') candidate.services.forEach(s => { if (s.account === project[kind][index].name) s.account = value.name; });
  }
  const before = new Set(validate(project).errors.map(e => e.message));
  const errors = validate(candidate).errors.filter(e => !before.has(e.message));
  if (errors.length) { $('#account-errors').innerHTML = note(errors.map(e => esc(e.message)).join('<br>'), 'error'); return; }
  project = candidate; changed(); closeDialog(); render(); toast('Changes applied. Save the project to keep them.');
}
function confirmDeletion(kind, index) {
  if (!['users', 'serviceAccounts'].includes(kind) || !project[kind][index]) return;
  const account = project[kind][index];
  if (kind === 'serviceAccounts' && project.services.some(s => s.account === account.name)) { toast('Reassign or remove the services using this account first.'); return; }
  deletion = { kind, index };
  dialog(`<p>This removes the account from this project and future exports. Existing images and running devices are unaffected.</p><div class="dialog-actions"><button class="danger" data-action="confirm-delete">Delete account</button><button data-action="close-dialog">Cancel</button></div>`, `<h2 class="account-dialog-title">${accountIcon(kind)}Delete ${esc(account.name)}?</h2>`);
}
function buildInfo() {
  dialog(`<p>Keep application versions and service permissions consistent across builds. Use individual public keys for people; keep private keys on their computers.</p><div class="table-scroll"><table class="accounts-table"><thead><tr><th>Build</th><th>Human access</th><th>Root SSH</th></tr></thead><tbody><tr><td>Development / provisioning</td><td>Individual developer keys; named users with sudo, or root keys when required</td><td>Key-only, if needed</td></tr><tr><td>QA</td><td>Named QA accounts with individual keys; sudo only as needed</td><td>Disabled</td></tr><tr><td>Release</td><td>SSH disabled, or approved support accounts and keys</td><td>Disabled</td></tr></tbody></table></div><p>Run web apps, APIs and background services as restricted service accounts in every build. A shared appsvc account is convenient; services sharing it can access each other's account-owned data.</p><p>QA should test the exact release artifact and checksum. Keep a separate diagnostic image when debugging needs extra access.</p><p class="subtle">These are recommendations. The editor currently provides a development preset, not linked build profiles or enforced release policies.</p><div class="dialog-actions"><button data-action="close-dialog">Close</button></div>`, `<h2>Recommended build configuration</h2>`);
}
function dismissToast() {
  clearTimeout(toast.timer);
  const container = $('#toast-container');
  container.hidePopover?.(); container.hidden = true;
}
function toast(message, kind = 'success') {
  const container = $('#toast-container');
  $('#toast').textContent = message;
  container.dataset.kind = kind; container.hidden = false;
  // Popovers appear above modal dialogs, so export/error notifications stay visible.
  container.showPopover?.();
  clearTimeout(toast.timer);
  toast.timer = setTimeout(dismissToast, kind === 'error' ? 10000 : 5500);
}
function partitionDisplay() {
  const rows = partitionRows(project).map(row => {
    const match = /^([1-9][0-9]*)(M|G)$/.exec(row.size);
    const size = match ? Number(match[1]) * (match[2] === 'G' ? 1024 : 1) : 0;
    const color = row.name === 'bootconfig' ? 'metadata' : row.name.startsWith('boot') ? 'boot' : row.name === 'system_b' ? 'system-b' : ['root', 'system_a'].includes(row.name) ? 'system' : row.name === 'persistent' ? 'persistent' : `data-${Number(row.name.slice(4)) % 4}`;
    return { ...row, color, mib: Number.isFinite(size) ? size : 0 };
  });
  const total = rows.reduce((sum, row) => sum + row.mib, 0);
  const proportional = rows.every(row => row.mib > 0) && Number.isFinite(total);
  let position = 0;
  const segments = rows.map(row => {
    const width = proportional ? row.mib / total * 1000 : 1000 / rows.length;
    const segment = `<g><title>${esc(`${row.number}. ${row.name}: ${row.size}, ${row.filesystem}`)}</title><rect class="partition-color-${row.color}" x="${position}" y="0" width="${width}" height="56"/></g>`;
    position += width;
    return segment;
  }).join('');
  const description = proportional ? 'Relative partition sizes. Alignment gaps and unused card space are not shown.' : 'Schematic only: sizes containing percentages or unresolved values are calculated during the build.';
  const totalLabel = proportional ? `${Number((total / 1024).toFixed(2))} GiB in partitions` : 'Sizes not yet resolved';
  return `<figure class="partition-display"><figcaption><strong>Disk layout</strong><span>${rows.length} partitions · ${totalLabel}</span></figcaption><svg class="partition-map" viewBox="0 0 1000 56" preserveAspectRatio="none" role="img" aria-label="${esc('Partitions in disk order. ' + rows.map(row => `${row.name}: ${row.size}`).join('; ') + '. ' + description)}">${segments}</svg><div class="partition-legend">${rows.map(row => {
    const label = `<span class="partition-swatch partition-color-${row.color}" aria-hidden="true"></span><span><strong>${esc(row.name)}</strong><small>${esc(row.size)} · ${esc(row.filesystem)}</small></span>`;
    return row.edit ? `<button type="button" data-edit-partition="${row.edit}" title="${esc(`Edit ${row.name}: ${row.purpose}`)}">${label}</button>` : `<span class="partition-fixed" title="${esc(row.purpose)}">${label}</span>`;
  }).join('')}</div><p>${description} Select a partition in the legend to edit it.</p></figure>`;
}
function partitionTable() {
  const ab = project.updates.strategy === 'ab';
  return `<div class="table-scroll"><table class="accounts-table"><thead><tr><th>#</th><th>Partition</th><th>Filesystem / label</th><th>Size</th><th>Mount / purpose</th><th>Actions</th></tr></thead><tbody>${partitionRows(project).map(r => `<tr><td>${r.number}</td><td><strong>${esc(r.name)}</strong></td><td>${esc(r.filesystem)}<br><span class="subtle">${esc(r.label)}</span></td><td>${esc(r.size)}</td><td>${esc(r.mount)}<br><span class="subtle">${esc(r.purpose)}</span></td><td class="table-actions">${r.edit ? `<button class="small" data-edit-partition="${r.edit}">Edit<span class="sr-only"> ${esc(r.name)}</span></button>` : '<span class="subtle">Fixed by Pi</span>'}${!ab && r.edit.startsWith('data:') ? `<button class="small danger" data-delete-partition="${r.edit.slice(5)}">Delete<span class="sr-only"> ${esc(r.name)}</span></button>` : ''}</td></tr>`).join('')}</tbody></table></div>${ab ? '<p class="subtle">The boot partitions contain boot.img; only the active slot’s boot and system partitions are mounted at their usual paths. Identical filesystem labels across paired slots are intentional; GPT partition names distinguish them.</p>' : '<br><button data-action="add-partition">+ Add data partition</button>'}`;
}
function openPartition(kind) {
  const ab = project.updates.strategy === 'ab', index = kind.startsWith('data:') ? Number(kind.slice(5)) : project.storage.partitions.length;
  const value = kind === 'boot' ? { size: project.storage.bootSize } : kind === 'system' ? { size: project.updates.systemSize } : kind === 'root' ? { size: project.storage.rootSize, filesystem: project.storage.rootFs } : kind === 'persistent' ? { size: project.updates.dataSize } : kind === 'new' ? { label: 'DATA' + (index + 1), size: '1G', mount: '/data/volume' + (index + 1) } : structuredClone(project.storage.partitions[index]);
  partitionDraft = { kind, index, value };
  const calculated = project.sizing.fillData && (kind === 'persistent' || (kind.startsWith('data:') && index === project.storage.partitions.length - 1));
  dialog(`<div id="partition-errors" role="alert"></div>${ab && ['boot','system'].includes(kind) ? note('This size applies to both A and B partitions, keeping the slot pair identical.') : ''}${kind === 'new' || kind.startsWith('data:') ? field('partition.label','Filesystem label','Unique uppercase name, up to 16 characters; numbers, underscores and hyphens are allowed.') + field('partition.mount','Mount directory','An absolute data directory, such as /simple-pi-data or /data/app. Protected system directories are blocked.') : ''}${calculated ? note('Size is calculated from destination capacity. Change Target storage capacity to adjust it.') : field('partition.size','Partition size',ab || kind === 'new' || kind.startsWith('data:') ? 'Absolute size such as 512M or 8G.' : 'Size such as 512M, 8G or 300%.')}${kind === 'root' ? field('partition.filesystem','Root filesystem','Filesystem used for the operating system partition.','select',['ext4','btrfs']) : ''}<div class="dialog-actions"><button class="primary" data-action="save-partition">Save partition</button><button data-action="close-dialog">Cancel</button></div>`, `<h2>${kind === 'new' ? 'Add data partition' : 'Edit partition'}</h2>`);
}
function savePartition() {
  const { kind, index, value } = partitionDraft, candidate = structuredClone(project);
  if (kind === 'boot') candidate.storage.bootSize = value.size;
  else if (kind === 'system') candidate.updates.systemSize = value.size;
  else if (kind === 'persistent') candidate.updates.dataSize = value.size;
  else if (kind === 'root') { candidate.storage.rootSize = value.size; candidate.storage.rootFs = value.filesystem; }
  else if (kind === 'new') candidate.storage.partitions.push(value);
  else candidate.storage.partitions[index] = value;
  const before = new Set(validate(project).errors.map(e => e.message));
  const errors = validate(candidate).errors.filter(e => !before.has(e.message));
  if (errors.length) { $('#partition-errors').innerHTML = note(errors.map(e => esc(e.message)).join('<br>'),'error'); return; }
  project = candidate; changed(); closeDialog(); render(); toast('Changes applied. Save the project to keep them.');
}
async function api(path, method = 'GET', body) {
  const response = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
}
function changed() { dirty = true; preview = null; updateChrome(); }
function updateChrome() {
  $('#sidebar-project').textContent = project.project.name;
  $('#save-status').textContent = dirty ? 'Unsaved changes' : id ? `Saved locally · revision ${revision}` : 'New project · not yet saved';
  const v = validate(project);
  $('#nav').innerHTML = sections.map(([key, label, icon]) => `<button data-nav="${key}" title="${label}" class="${section === key ? 'active' : ''}" ${section === key ? 'aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${icon}</span><span class="nav-text">${label}</span>${v.errors.filter(e => e.section === key).length ? `<span class="nav-count">${v.errors.filter(e => e.section === key).length}</span>` : ''}</button>`).join('');
}
function render() {
  updateChrome(); const s = sections.find(x => x[0] === section);
  $('#content').innerHTML = `<div class="page-heading compact-heading"><h1><span class="workspace-label">Workspace</span><span class="heading-separator" aria-hidden="true">/</span>${esc(s[1])}</h1><span class="step-label">${String(sections.indexOf(s) + 1).padStart(2, '0')} / ${sections.length}</span></div>${views[section]()}<div class="bottom-nav">${sections.indexOf(s) > 0 ? `<button data-nav="${sections[sections.indexOf(s) - 1][0]}">← Previous section</button>` : '<span></span>'}${section !== 'export' ? next(sections[sections.indexOf(s) + 1][0]) : ''}</div>`;
}
const views = {
  services() {
    const accounts = [['', 'Choose a service account'], ...project.serviceAccounts.map(a => [a.name, a.name])];
    return columns(note('Use your development account for SSH and sudo. These services run as separate non-login accounts with no sudo, no capabilities, and a read-only system filesystem. Application binaries must be installed using packages, target files, or your build script.') +
      (project.serviceAccounts.length ? '' : note('First add a restricted account under <button class="small" data-nav="users">Users & access</button>.', 'warn')) +
      project.services.map((s, i) => card(esc(s.name || 'New service') + '.service', 'Foreground application managed by systemd.', `<div class="field-grid">${field(`services.${i}.name`, 'Service name', 'Lowercase name without .service; must not replace an installed unit.')}${field(`services.${i}.account`, 'Run as account', 'Only restricted service accounts appear here.', 'select', accounts)}<div class="wide">${field(`services.${i}.description`, 'Description', 'A short description shown by systemctl.')}</div>${field(`services.${i}.executable`, 'Executable', 'Absolute path to the installed program. No shell command or arguments here.')}${field(`services.${i}.workingDirectory`, 'Working directory', 'Existing application directory, usually under /opt. Leave blank to use /.')}<div class="wide">${field(`services.${i}.arguments`, 'Arguments', 'One literal argument per line. Spaces within a line stay together. No shell expansion or pipes.', 'code')}</div>${field(`services.${i}.stateDirectory`, 'Persistent data directory', 'A name such as myapp creates /var/lib/myapp, owned by this account. Blank disables it.')}${field(`services.${i}.runtimeDirectory`, 'Temporary runtime directory', 'A name creates /run/name. Removed when stopped; useful for sockets and PID files.')}<div class="wide">${field(`services.${i}.writablePaths`, 'Extra writable directories', 'One absolute application data directory per line, such as /simple-pi-data. Created at service start, owned by the account, mode 0700.', 'code')}</div>${field(`services.${i}.restart`, 'Restart policy', 'The application must stay in the foreground. Restart delay is five seconds.', 'select', [['on-failure', 'Restart on failure'], ['always', 'Always restart'], ['no', 'Do not restart']])}</div><br>${toggle(`services.${i}.enabled`, 'Start at boot', 'Off keeps the service installed for manual testing with sudo systemctl start.')}${toggle(`services.${i}.network`, 'Allow network access', 'Off isolates the service from the host network, including host localhost.')}<div class="section-actions"><span class="subtle">Hardware access follows the selected account’s groups.</span><button class="small danger" data-remove-service="${i}">Remove service</button></div>`)).join('') + '<button data-action="add-service">+ Add application service</button>',
      tip('Develop without loosening the service', '<p>Log in using your development account. Use sudo to install binaries and manage the service:</p><pre>sudo systemctl start myapp\nsudo systemctl status myapp\nsudo journalctl -u myapp -f</pre><p>Test file and device permissions with:</p><pre>sudo -u myservice /opt/myapp/run-tests</pre><p>This last command tests the account permissions only. Start the systemd service to test its full sandbox.</p>') + tip('What can it access?', '<p>Only configured persistent, runtime and extra data directories are writable, plus private temporary storage. Home directories are hidden. Logs go to the journal.</p><p>Accounts without hardware groups get a private device namespace. Selecting hardware groups exposes host devices, with access still controlled by Linux device permissions. Enable the corresponding Pi interface under Hardware & boot.</p><p>System services still use root where required. These restrictions apply to your application services.</p>'));
  },
  overview() {
    const v = validate(project);
    return columns(`${card('Project details', '', `<div class="field-grid">${field('project.name','Project name','A friendly name for your workspace.')}${field('project.slug','Export folder name','Used for the bundle folder and image filename.')}${field('project.version','Project version','A label to track your configuration revisions.')}<div class="field"><span>Target device ${help('Optimised for the Raspberry Pi 5 family.')}</span><input aria-label="Target device" value="Raspberry Pi 5 · 64-bit (ARM64)" disabled></div><div class="wide">${field('project.description','Project notes','Describe what this image is for.','textarea')}</div></div>`)}<div class="section-actions"><h2>Make it yours</h2><span class="subtle">A few good places to start</span></div><div class="quick-grid"><button class="quick" data-nav="users"><span class="quick-icon">♙</span><b>Users & access →</b><span>Set up your account and SSH keys.</span></button><button class="quick" data-nav="network"><span class="quick-icon">⌘</span><b>Networking →</b><span>Help your Pi find its way online.</span></button><button class="quick" data-nav="gadget"><span class="quick-icon">♧</span><b>USB Ethernet →</b><span>Connect directly with a USB cable.</span></button></div>`, `${card('Image at a glance','',`<dl class="summary-list"><div><dt>Device</dt><dd>Raspberry Pi 5</dd></div><div><dt>Base</dt><dd>${project.system.suite.startsWith('trixie') ? 'Debian Trixie' : 'Debian Bookworm'}</dd></div><div><dt>Architecture</dt><dd>ARM64</dd></div><div><dt>Storage</dt><dd>${project.system.storage === 'sd' ? 'microSD' : 'NVMe'} · ${project.updates.strategy === 'ab' ? 'GPT / A/B' : project.storage.table.toUpperCase()}</dd></div><div><dt>Root filesystem</dt><dd>${esc(project.storage.rootFs)} · ${esc(project.updates.strategy === 'ab' ? project.updates.systemSize + ' per slot' : project.storage.rootSize)}</dd></div><div><dt>Accounts</dt><dd>${project.users.length} user${project.users.length === 1 ? '' : 's'}</dd></div></dl>`)}${card('Documentation references','Official Raspberry Pi guides and references.', `<ul class="reference-list"><li><a href="https://raspberrypi.github.io/rpi-image-gen/" target="_blank" rel="noreferrer">rpi-image-gen documentation ?</a><span>Build system overview and technical reference.</span></li><li><a href="https://github.com/raspberrypi/rpi-image-gen/blob/master/getting_started.adoc" target="_blank" rel="noreferrer">Getting started &amp; cross-building ?</a><span>Prepare your build environment and run a build.</span></li><li><a href="https://raspberrypi.github.io/rpi-image-gen/config/index.html" target="_blank" rel="noreferrer">Configuration reference ?</a><span>Configuration files, settings and overrides.</span></li><li><a href="https://raspberrypi.github.io/rpi-image-gen/layer/index.html" target="_blank" rel="noreferrer">Layers &amp; hooks ?</a><span>Extend an image with packages and scripts.</span></li><li><a href="https://raspberrypi.github.io/rpi-image-gen/layer/image-rota.html" target="_blank" rel="noreferrer">Field updates &amp; A/B layout ?</a><span>Read-only systems and persistent application data.</span></li><li><a href="https://github.com/raspberrypi/rpi-usb-gadget" target="_blank" rel="noreferrer">USB Ethernet gadget ?</a><span>USB networking and host setup guidance.</span></li></ul>`)}${note(v.errors.length ? `<b>${v.errors.length} item${v.errors.length === 1 ? '' : 's'} to finish</b><br>Your draft can be saved at any time. Review & export shows what needs attention.` : '<b>Configuration checks passed</b><br>Review your files before running the build.', v.errors.length ? 'warn' : '')}`);
  },
  system() { return columns(card('Device & operating system','A minimal base gives you room to add only what you need.', `<div class="field-grid">${field('system.hostname','Hostname','The name of this Pi on your network, for example workshop-pi.')}${field('system.suite','Base system','The suite installs the base OS, networking, and SSH.','select',[['trixie-minbase','Debian 13 · Trixie minimal'],['bookworm-minbase','Debian 12 · Bookworm minimal']])}${field('system.storage','Boot storage','Choose where the image will be written.','select',[['sd','microSD card'],['nvme','NVMe SSD']])}</div>`) + card('Language & region','These settings apply inside the generated image.', `<div class="field-grid">${field('system.timezone','Timezone','IANA timezone, such as Europe/Dublin or America/New_York.')}${field('system.locale','System locale','A UTF-8 locale installed on the target, such as en_US.UTF-8.')}${field('system.keyboard','Keyboard keymap','Linux keyboard code: gb, us, de, fr, etc.')}${field('system.keyboardLabel','Keyboard description','Human-readable keyboard layout, such as English (US).')}</div>`), tip('What is a base system?', '<p>A suite is a group of rpi-image-gen layers. The minimal suites give you a command-line system. Add applications in Packages & services.</p><p>This editor targets the upstream Pi 5 layer and its ARM64 kernel. Your WSL build host can be x86-64 if its ARM emulation is configured.</p>')); },
  users() {
    const server = card('SSH server policy', 'Applies to every account in this image.', `<div class="field-grid"><div>${toggle('ssh.enabled','Enable SSH server','Allow remote connections to the Pi.')}${project.ssh.enabled ? toggle('ssh.keyOnly','Require SSH keys','When enabled, account passwords cannot be used for SSH.') : '<p class="subtle">SSH is disabled for all accounts, including root. Account credentials are retained for later use and local login.</p>'}</div>${project.ssh.enabled ? field('ssh.port','SSH port','22 is the standard SSH port.','number') : ''}</div>`);
    const guidance = tip('Accounts & access', '<h3>1. Set remote access</h3><p>Choose the SSH server policy first. It controls all accounts; individual keys cannot bypass a disabled server or the key-only rule.</p><h3>2. Manage accounts</h3><p>Use a named login account with an individual public key for each developer. Add sudo only when needed. Edit opens account credentials and privileges; Delete requires confirmation.</p><h3>3. Assign application identities</h3><p>Create restricted service accounts here, then select them under Application services. They cannot log in or use sudo. Hardware groups grant access to selected device classes.</p><h3>Root &amp; the primary account</h3><p>Root is managed by the OS. All non-root login accounts can be deleted. With no login accounts, enable root SSH with a key for remote access. Root SSH needs explicit permission and its own public key; edit the root row to configure it.</p><h3>Development to release</h3><p>Prefer a named developer account with sudo. Disable root SSH for releases and retain only approved support access, or disable SSH entirely.</p><button class="small" data-action="build-info">Recommended build configurations</button>');
    return columns(server + accountTable(), guidance);
  },
  network() { return columns(card('Ethernet','The onboard wired network connection (eth0).', field('network.ethernet','Address assignment','Automatic DHCP is right for most home and office networks.','select',[['auto','Automatic · DHCP'],['manual','Static IPv4 address'],['disabled','Disabled / unmanaged']]) + (project.network.ethernet === 'manual' ? `<div class="field-grid">${field('network.address','IP address / prefix','Example: 192.168.1.50/24. Use an unused address on your subnet.')}${field('network.gateway','Gateway','Usually your router, for example 192.168.1.1.')}${field('network.dns','DNS servers','Comma-separated IPv4 addresses for name resolution.')}</div>` : '')) + card('Wireless network','Preconfigure a WPA/WPA2 personal network.', toggle('network.wifi','Configure Wi-Fi','Connect automatically on first boot.') + (project.network.wifi ? `<br><div class="field-grid">${field('network.ssid','Network name (SSID)','Case-sensitive name of your Wi-Fi network.')}${field('network.psk','Wi-Fi password','Stored in the project file and exported network profile.','password')}${field('network.country','Regulatory country','Two-letter country code, such as IE, GB, or US.')}</div><br>${toggle('network.hidden','Hidden network','Enable only if your access point does not broadcast its name.')}` : '')) + card('Local discovery','Find your Pi by name on the local network.', toggle('network.mdns','Enable mDNS','Advertise hostname.local using Avahi.')), tip('DHCP or static?', '<p><b>DHCP</b> lets your router choose an address automatically. It is the easiest starting point.</p><p><b>Static</b> fixes the address in the image. Avoid addresses already used by another device or assigned by your router.</p><p>NetworkManager controls these connections. IPv6 uses its default behaviour on Ethernet and Wi-Fi.</p>') + note(`With mDNS enabled, try <code>ssh ${esc(project.users[0]?.name || 'root')}@${esc(project.system.hostname)}.local</code>.`)); },
  storage() {
    let capacityText = '';
    if (project.sizing.fillData) { try { capacityText = note('Calculated data partition: <b>' + dataCapacity(project) + '</b>'); } catch(e) { capacityText = note(esc(e.message), 'warn'); } }
    const imageSettings = card('Image & capacity', 'Choose the image layout and data capacity.',
      '<div class="field-grid"><div>' + field('updates.strategy', 'Image strategy', 'Standard is writable. A/B uses paired system slots and shared data. Standard settings are kept when switching modes.', 'select', [['standard','Standard · writable system'], ['ab','Field updates (A/B) · two system slots']]) +
      (project.updates.strategy === 'ab' ? '<p class="subtle">A/B provides the layout. Update delivery and rollback checks need separate integration.</p>' : '') + '</div><div>' +
      toggle('sizing.fillData', 'Use remaining capacity for data', 'Fills the final data partition, or A/B persistent data, for the entered device capacity.') +
      (project.sizing.fillData ? field('sizing.capacityGB', 'Device capacity (GB)', 'Decimal GB: 32 means 32 billion bytes. A 64 MiB reserve allows for layout overhead and small device variations.') + capacityText : '') +
      '</div></div><p class="subtle">Build-time sizing only; no first-boot expansion.</p>');
    const bootInfo = tip('What is boot-config?', '<p>Standard images use the BOOT partition for firmware and config.txt. A separate boot-config partition is not needed.</p><p>A/B images automatically include a 32 MiB BOOTCONFIG partition mounted at /bootfs. It holds autoboot.txt for choosing the A or B boot partition. Each slot also has its own boot files.</p><p>The upstream image layer manages this layout. You do not need to add a boot-config partition yourself.</p>');
    const layout = card(project.updates.strategy === 'ab' ? 'Field-update storage' : 'Partitions', project.updates.strategy === 'ab' ? 'Raspberry Pi image-rota: GPT, 8 MiB alignment, fixed partition order.' : 'Boot and root come first; add data partitions as needed.', partitionDisplay() + partitionTable());
    const options = project.updates.strategy === 'ab' ? card('Field-update options', 'Upstream defaults: EROFS systems and ext4 persistent data.', toggle('updates.shareAppData','Keep application data across updates','Share guided services? /var/lib data directories between A and B. Database changes must support rollback.') + '<details><summary>Advanced: update payload</summary><br>' + field('updates.bundle','Additional update output','Requires separate release delivery integration.','select',[['none','Initial disk image only'],['otamaker','Also generate otamaker payload']]) + '</details><p class="subtle">The native image-rota layer generates all six partitions. Names, order and BOOTCONFIG size are fixed. Edit either A/B member to change both members together. Automatic delivery and boot confirmation require a deployment system.</p><a href="https://raspberrypi.github.io/rpi-image-gen/layer/image-rota.html" target="_blank" rel="noreferrer">Raspberry Pi layout reference ?</a>') : card('Layout options', '', '<div class="field-grid">' + field('storage.table','Partition table','MBR supports two extra data partitions. GPT supports more.','select',[['mbr','MBR'],['gpt','GPT']]) + field('storage.diskSignature','MBR disk signature','Use random unless a fixed signature is required.') + '</div>');
    const recommendations = tip('Recommended partitioning strategies', '<h3>Development &amp; testing</h3><p>Use a Standard image with a writable ext4 root. MBR is simplest for boot, root and up to two data partitions. Use GPT if you need more partitions.</p><h3>Application data</h3><p>Keep changing data separate from the OS when appropriate. A custom mount such as <code>/simple-pi-data</code> is valid. System trees such as /etc, /usr and /boot are protected by the editor.</p><h3>Devices in the field</h3><p>Use Field updates (A/B) for two system copies and one persistent partition. Raspberry Pi fixes the order: bootconfig, boot_a, boot_b, system_a, system_b, persistent. A deployment client and health confirmation are still required.</p><h3>Capacity planning</h3><p>Reserve room in each system partition for future releases. Remaining-capacity mode uses decimal device GB and binary partition M/G units, with a 64 MiB layout reserve. It does not grow on first boot.</p><h3>QA &amp; release</h3><p>Test the same layout and application permissions you deploy. Check rollback and data-schema compatibility before a field rollout.</p><a href="https://raspberrypi.github.io/rpi-image-gen/layer/image-rota.html" target="_blank" rel="noreferrer">Raspberry Pi field-update layout &rarr;</a>');
    return columns(imageSettings + layout + '<details class="storage-advanced"><summary>Advanced layout options</summary><br>' + options + '</details>', recommendations + bootInfo);
  },
  gadget() { return columns(card('USB Ethernet gadget','A private network link over the Pi 5 USB-C port.', toggle('gadget.enabled','Enable USB Ethernet','Load the dwc2 controller and g_ether module at boot.') + (project.gadget.enabled ? `<br>${field('gadget.mode','Network mode','Choose which side supplies addresses.','select',[['shared','Shared · Pi provides DHCP to host'],['auto','DHCP client · host provides addresses'],['manual','Manual · configure both ends']])}${project.gadget.mode !== 'auto' ? field('gadget.address','Pi USB address / prefix','Use a subnet different from your Ethernet and Wi-Fi networks.') : ''}<div class="field-grid">${field('gadget.deviceMac','Pi MAC address','Locally administered unicast MAC address. Must be unique.')}${field('gadget.hostMac','Host MAC address','A different locally administered MAC for the host side.')}</div>` : '<br>' + note('Enable this to connect directly without a router, monitor, or Wi-Fi.'))),
      usbNetworkGuide()); },
  hardware() { return columns(card('Hardware interfaces','Enable only the interfaces your project uses.', toggle('hardware.i2c','I²C','Connect sensors and other peripherals over the I²C bus.') + toggle('hardware.spi','SPI','Enable the SPI interface for displays and peripherals.') + toggle('hardware.uart','Serial UART','Enable the primary UART. This does not configure a serial login console.') + toggle('hardware.disableBluetooth','Disable Bluetooth','Disable the onboard Bluetooth controller.') + toggle('hardware.disableWifi','Disable Wi-Fi hardware','Disable the onboard Wi-Fi radio.')) + card('Boot customisation','Advanced firmware and Linux settings.', field('hardware.config','Additional config.txt lines','Appended in an [all] section after standard firmware settings.','code') + field('hardware.cmdline','Additional kernel arguments','One line of arguments, for example quiet loglevel=3. Do not replace root= here.')), tip('Firmware versus kernel', '<p><code>config.txt</code> controls firmware and device-tree overlays. It is read before Linux starts.</p><p>The kernel command line controls Linux startup. These arguments are added through the linux-base layer’s command-line drop-in.</p><p>Custom lines can override guided settings. Review the generated files if you change the same setting in both places.</p>')); },
  software() { return columns(card('Additional packages','Install from the repositories supplied by your base layers.', field('software.packages','Debian packages','One package per line or separated by spaces. Optional pinned version: package=version.','code')) + card('System services','Apply systemd enable or mask rules in the image.', field('software.enableServices','Enable at boot','Unit names, one per line. The package providing each unit must be installed.','code') + field('software.disableServices','Mask services','Masked units cannot start, even as dependencies. One unit name per line.','code')), tip('A repeatable software setup', '<p>Packages are installed when you build the image in WSL. You need access to the configured Debian and Raspberry Pi repositories.</p><p>Pin exact versions only if they remain available in those repositories.</p><p>The editor automatically includes NetworkManager and the packages required for your selected features.</p><p>A service name includes its extension, for example <code>nginx.service</code> or <code>backup.timer</code>.</p>')); },
  advanced() { return columns(note('These settings are for custom integrations. Scripts execute inside the target as root; upstream configuration values may contain shell expansion. Review before running the exported bundle.', 'warn') + card('Extra layers & configuration','Extend the guided configuration without losing it.', field('advanced.layers','Additional upstream layers','One installed rpi-image-gen layer name per line.','code') + field('advanced.config','Configuration overrides (JSON)','Section objects override generated config.yaml values. Example: {"image":{"compression":"xz"}}.','code')) + card('Target filesystem files','Create text files inside the image.', project.advanced.files.map((f,i) => `<div class="card-body">${field(`advanced.files.${i}.path`,'Target path','Absolute path under /etc, /opt, /usr/local, or /var/lib.')}${field(`advanced.files.${i}.content`,'File contents','Stored in this project and written by the customisation hook.','code')}${toggle(`advanced.files.${i}.executable`,'Executable file','Set file permissions to 755 instead of 644.')}<br><button class="danger small" data-remove-file="${i}">Remove file</button></div>`).join('') + '<button data-action="add-file">+ Add a text file</button>') + card('Custom build script','Runs after the editor’s account, network, and file setup.', field('advanced.script','Bash script','Runs in the target chroot with set -euo pipefail. No target services are running during the build.','code')), tip('Know what will run', '<p>Use the file preview in Review & export to inspect every generated script.</p><p>Config overrides take precedence over guided fields. They can change assumptions the editor makes, including layers, paths, or identity.</p><p>Additional layer names must already exist in your WSL installation. Use <code>rpi-image-gen layer --describe NAME</code> to inspect a layer.</p>')); },
  export() {
    const v = validate(project);
    const issue = x => `<div class="issue"><span>${esc(x.message)}</span><button class="small" data-nav="${x.section}">Edit</button></div>`;
    const checks = card('Configuration checks', '', `<div class="review-summary"><strong>${v.errors.length ? v.errors.length + ' to fix' : 'Ready to export'}</strong><span class="subtle">${v.warnings.length} warning${v.warnings.length === 1 ? '' : 's'}</span></div>${v.errors.map(issue).join('')}${v.warnings.length ? '<details class="review-warnings"><summary>Review warnings (' + v.warnings.length + ')</summary>' + v.warnings.map(issue).join('') + '</details>' : ''}`);
    const bundle = card('Export bundle', '', `<dl class="summary-list"><div><dt>Project</dt><dd>${esc(project.project.name)}</dd></div><div><dt>Version</dt><dd>${esc(project.project.version)}</dd></div><div><dt>Image</dt><dd>Pi 5 / ARM64 / ${project.updates.strategy === 'ab' ? 'A/B' : 'Standard'}</dd></div></dl><div class="dialog-actions"><button data-action="preview" ${v.errors.length ? 'disabled' : ''}>Preview files</button><button class="primary" data-action="export" ${v.errors.length ? 'disabled' : ''}>Create export bundle</button></div><p class="subtle">Saves your project and creates a folder plus a downloadable archive.</p>`);
    return columns(checks + bundle, tip('Review, export & build', '<ol class="steps"><li><b>Review</b><p>Fix errors and check warnings. Preview files in the dialog.</p></li><li><b>Export</b><p>Download the archive or copy the generated folder.</p></li><li><b>Build in WSL</b><p>Extract into your Ubuntu home directory. Follow the bundle README.</p></li></ol><p class="subtle">Preflight checks do not verify boot. Test the image on your Pi before deployment.</p>'));
  }

};

async function save(notify = true) {
  const doc = id ? await api(`/api/projects/${id}`, 'PUT', { config: project, revision }) : await api('/api/projects', 'POST', { config: project });
  id = doc.id; revision = doc.revision; dirty = false; localStorage.setItem('picreator-last-project', id); updateChrome(); if (notify) toast(`Saved "${project.project.name}" on this computer.`); return doc;
}
async function load(projectId, notify = true) {
  const doc = await api(`/api/projects/${projectId}`);
  const config = normalizeProject(doc.config);
  if (validate(config).malformed) throw new Error('This project has an unsupported or damaged settings format. Your current draft has been kept.');
  project = config; id = doc.id; revision = doc.revision; dirty = false; preview = null; localStorage.setItem('picreator-last-project', id); render(); if (notify) toast(`Loaded "${project.project.name}".`);
}
function downloadJSON() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2) + '\n'], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `${project.project.slug || 'project'}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function closeDialog() { $('#dialog').close(); accountDraft = null; deletion = null; partitionDraft = null; }
function dialog(html, header = '') { $('#dialog-body').innerHTML = `<div class="dialog-head">${header}<button data-action="close-dialog" class="small" aria-label="Close dialog">×</button></div>${html}`; if (!$('#dialog').open) $('#dialog').showModal(); }
function previewDialog() {
  if (!preview) return;
  const purposeFor = path => {
    const known = {
      'project.json': 'Editable project settings; import to continue editing.',
      'config.yaml': 'Main rpi-image-gen build configuration.',
      'partitions.json': 'Resolved partition order, filesystems and sizes.',
      'build.sh': 'Check prerequisites and start rpi-image-gen in WSL.',
      'create-rpi-builder.ps1': 'Recreate rpi-builder, then install rpi-image-gen and dependencies. Deletes existing builder data.',
      'build-in-wsl.ps1': 'Start rpi-builder, copy this bundle into Linux and build the Pi image.',
      'manifest.json': 'SHA-256 checksums for the exported files.',
      'README.md': 'Build instructions and compatibility notes.',
      'STORAGE.md': 'Partition sizing and storage strategy.',
      'SERVICES.md': 'Service permissions, operation and testing.',
      'UPDATE-STRATEGY.md': 'A/B deployment requirements and integration steps.'
    };
    if (known[path]) return known[path];
    if (path.endsWith('genimage.cfg.in')) return 'Disk image and filesystem layout template.';
    if (path.endsWith('/fstab')) return 'Filesystem mount entries for the target OS.';
    if (path.endsWith('mke2fs.conf')) return 'ext4 filesystem creation settings.';
    if (path.endsWith('install-fstab.sh')) return 'Install mount entries when assembling the root filesystem.';
    if (path.includes('preimage99-layout')) return 'Resolve image-template paths and filesystem IDs at build time.';
    if (path.endsWith('-image.yaml')) return 'Declare the custom image layer and its dependencies.';
    if (path.endsWith('-settings.yaml')) return 'Declare project packages and base-layer dependencies.';
    if (path.includes('/hooks/')) return 'Apply account permissions and service setup during the build.';
    if (path.startsWith('keys/')) return 'Public key installed through the upstream SSH layer.';
    if (path.endsWith('authorized_keys')) return 'Public keys allowed to authenticate this account.';
    if (path.includes('sshd_config.d')) return 'SSH authentication policy, root access and port.';
    if (path.includes('/sudoers.d/')) return 'Administrator privileges for a login account.';
    if (path.endsWith('.nmconnection')) return 'NetworkManager connection profile and addressing.';
    if (path.includes('NetworkManager/conf.d')) return 'NetworkManager interface management policy.';
    if (path.includes('wifi-country.service')) return 'Set the Wi-Fi regulatory country before networking starts.';
    if (path.includes('slot-shared.d')) return 'Application data directories shared across A/B slots.';
    if (path.includes('modules-load.d')) return 'Kernel modules loaded automatically at boot.';
    if (path.includes('modprobe.d')) return 'Kernel module options, including USB MAC addresses.';
    if (path.includes('config.txt.d')) return 'Firmware settings and device-tree overlay fragment.';
    if (path.includes('cmdline.d')) return 'Additional Linux kernel boot arguments.';
    if (path.includes('-prepare-') && path.endsWith('.service')) return 'Prepare application data directories after their filesystems mount.';
    if (path.includes('/tmpfiles.d/') || (path.startsWith('services/') && path.endsWith('.conf'))) return 'Data directory ownership and permissions.';
    if (path.endsWith('.service')) return 'Application startup, identity and systemd restrictions.';
    if (path.includes('customize.overlay')) return 'Text file installed at the corresponding target path.';
    return 'Supporting file for the generated build.';
  };
  const groups = new Map();
  const groupFor = path => {
    if (/\.md$/i.test(path)) return 'Documentation';
    if (path === 'manifest.json') return 'Checksums';
    if (['project.json','config.yaml','partitions.json','build.sh','create-rpi-builder.ps1','build-in-wsl.ps1'].includes(path)) return 'Project & build';
    if (path.startsWith(`layer/${project.project.slug}-image`)) return 'Partition layout';
    if (/NetworkManager|regdomain/.test(path)) return 'Networking';
    if (/ssh|sudoers|^keys\//.test(path)) return 'Accounts & SSH';
    if (/^services\/|systemd\/|tmpfiles\//.test(path)) return 'Services';
    if (/config.txt.d|cmdline.d|modules-load.d|modprobe.d/.test(path)) return 'Hardware & boot';
    if (/customize.overlay/.test(path)) return 'Target files';
    return 'Layers & hooks';
  };
  for (const path of Object.keys(preview.files)) {
    const group = groupFor(path);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(path);
  }
  const order = ['Project & build','Partition layout','Accounts & SSH','Networking','Hardware & boot','Services','Target files','Layers & hooks','Documentation','Checksums'];
  const list = `<table class="preview-details"><thead><tr><th scope="col">File</th><th scope="col">Purpose</th></tr></thead>${order.filter(group => groups.has(group)).map(group => `<tbody><tr class="preview-group-title"><th colspan="2" scope="colgroup">${esc(group)}</th></tr>${groups.get(group).map(path => `<tr class="${activeFile === path ? 'active' : ''}"><td><button data-file="${esc(path)}" title="${esc(path)}" aria-pressed="${activeFile === path}"><strong>${esc(path.split('/').pop())}</strong>${path.includes('/') ? `<span class="preview-path">${esc(path)}</span>` : ''}</button></td><td>${esc(purposeFor(path))}</td></tr>`).join('')}</tbody>`).join('')}</table>`;
  dialog(`<div class="file-preview"><nav class="preview-file-list" aria-label="Generated files">${list}</nav><div class="preview-file-content"><h3>${esc(activeFile)}</h3><pre class="code-view" tabindex="0">${esc(preview.files[activeFile]?.content || '')}</pre></div></div>`, `<div class="preview-heading"><h2>Generated files</h2><span class="subtle">${Object.keys(preview.files).length} files ? Read-only</span></div>`);
}
async function projectsDialog() {
  const list = await api('/api/projects');
  dialog(`<p class="subtle">Saved on this computer. Import a project JSON to continue elsewhere.</p>${dirty ? note('You have unsaved changes. Save or download your draft before opening another project.', 'warn') : ''}<div>${list.length ? list.map(x => `<div class="project-row"><div><b>${esc(x.name)}</b><small>Saved ${esc(new Date(x.updatedAt).toLocaleString())}</small></div><button data-open="${x.id}">Open</button></div>`).join('') : '<div class="empty">No saved projects yet.</div>'}</div><div class="dialog-actions"><button data-action="new" class="primary">+ New project</button><button data-action="import">Import JSON</button><button data-action="download-json">Download current JSON</button></div>`, `<h2>Your projects</h2>`);
}
async function exportProject() {
  if (validate(project).errors.length) { section = 'export'; render(); toast('Resolve the highlighted settings before exporting.'); return; }
  await save(false); const result = await api(`/api/projects/${id}/export`, 'POST', { revision });
  toast(`Export bundle created for "${project.project.name}".`);
  dialog(`<p>A structured source folder has been created:</p><div class="note export-success"><code>${esc(result.folder)}</code></div><p class="subtle">Copy it into the WSL Linux filesystem, or download an archive below. The included README explains the build steps.</p><a class="download-link" href="${esc(result.download)}" download>Download ${esc(project.project.slug)}.tar.gz ↓</a><p class="subtle">${result.files.length} files · scripts, layers, configuration, and checksums</p>`, `<h2>Your bundle is ready</h2>`);
}
async function action(fn) { if (busy) return; busy = true; try { await fn(); } catch(e) { toast(e.message, 'error'); } finally { busy = false; } }
document.addEventListener('input', e => {
  if (e.target.dataset.draftGroup) { const groups = new Set(words(accountDraft.value.groups)); if (e.target.checked) groups.add(e.target.dataset.draftGroup); else groups.delete(e.target.dataset.draftGroup); accountDraft.value.groups = [...groups].join(','); return; }
  if (e.target.dataset.path?.startsWith('partition.')) { set(e.target.dataset.path, e.target.value); return; }
  if (e.target.dataset.path?.startsWith('draft.')) { set(e.target.dataset.path, e.target.type === 'checkbox' ? e.target.checked : e.target.value); return; }
  if (e.target.dataset.accountGroup !== undefined) {
    const a = project.serviceAccounts[Number(e.target.dataset.accountGroup)], group = e.target.dataset.group;
    const selected = new Set(words(a.groups));
    if (e.target.checked) selected.add(group); else selected.delete(group);
    a.groups = [...selected].join(','); changed(); return;
  }
  const target = e.target, path = target.dataset.path; if (!path) return;
  if (/^serviceAccounts\.\d+\.name$/.test(path)) {
    const old = get(path); for (const s of project.services) if (s.account === old) s.account = target.value;
  }
  set(path, target.type === 'checkbox' ? target.checked : target.type === 'number' ? Number(target.value) : target.value); changed();
});
document.addEventListener('change', e => {
  if (e.target.dataset.path?.startsWith('draft.') || e.target.dataset.path?.startsWith('partition.')) return;
  if (e.target.dataset.path && (e.target.dataset.path.startsWith('sizing.') || ['storage.bootSize','storage.rootSize','updates.systemSize'].includes(e.target.dataset.path))) { render(); return; }
  if (e.target.dataset.path && (e.target.tagName === 'SELECT' || e.target.type === 'checkbox')) render();
});
document.addEventListener('click', e => {
  const el = e.target.closest('button,[data-nav]'); if (!el) return;
  if (el.dataset.action === 'dismiss-toast') { dismissToast(); return; }
  if (el.dataset.editPartition) { openPartition(el.dataset.editPartition); return; }
  if (el.dataset.deletePartition !== undefined) { deletion = { kind: 'partition', index: Number(el.dataset.deletePartition) }; dialog('<p>This removes the partition from future image builds. Existing devices are unaffected.</p><div class="dialog-actions"><button class="danger" data-action="confirm-partition-delete">Delete partition</button><button data-action="close-dialog">Cancel</button></div>', '<h2>Delete data partition?</h2>'); return; }
  if (el.dataset.editKind) { openAccount(el.dataset.editKind, Number(el.dataset.index)); return; }
  if (el.dataset.deleteKind) { confirmDeletion(el.dataset.deleteKind, Number(el.dataset.index)); return; }
  if (el.dataset.nav) { section = el.dataset.nav; render(); window.scrollTo(0, 0); return; }
  if (el.dataset.file && preview?.files[el.dataset.file]) { activeFile = el.dataset.file; previewDialog(); return; }
  if (el.dataset.removeAccount !== undefined && project.services.some(s => s.account === project.serviceAccounts[Number(el.dataset.removeAccount)].name)) { toast('Reassign or remove the services using this account first.'); return; }
  for (const [key, list] of [['removeUser', project.users], ['removePartition', project.storage.partitions], ['removeFile', project.advanced.files], ['removeAccount', project.serviceAccounts], ['removeService', project.services]]) if (key in el.dataset) { list.splice(Number(el.dataset[key]), 1); changed(); render(); return; }
  if (el.dataset.open) return action(async () => { if (dirty && !confirm('Discard unsaved changes and open this project?')) return; await load(el.dataset.open); closeDialog(); });
  const commands = {
    'add-account': () => openAccount('serviceAccounts'),
    'save-account': saveAccount,
    'build-info': buildInfo,
    'confirm-delete': () => { const {kind,index} = deletion; project[kind].splice(index,1); changed(); closeDialog(); render(); toast('Account removed from this draft.'); },
    'add-service': () => { const name = `myapp${project.services.length + 1}`; project.services.push({ ...serviceDefaults(), name, stateDirectory: name, account: project.serviceAccounts[0]?.name || '' }); changed(); render(); },
    'add-user': () => openAccount('users'),
    'add-partition': () => openPartition('new'),
    'save-partition': savePartition,
    'confirm-partition-delete': () => { project.storage.partitions.splice(deletion.index, 1); changed(); closeDialog(); render(); toast('Partition removed from this draft.'); },
    'add-file': () => { project.advanced.files.push({ path: '/etc/my-app.conf', content: '', executable: false }); changed(); render(); },
    'preview': async () => { preview = await api('/api/preview', 'POST', { config: project }); if (!preview.files[activeFile]) activeFile = Object.keys(preview.files)[0]; previewDialog(); },
    'export': exportProject,
    'close-dialog': closeDialog,
    'download-json': downloadJSON,
    'import': () => $('#import-file').click(),
    'new': () => { if (dirty && !confirm('Discard unsaved changes and start a new project?')) return; project = defaults(); id = null; revision = 0; dirty = false; preview = null; section = 'overview'; localStorage.removeItem('picreator-last-project'); closeDialog(); render(); toast('New project created. Save it when ready.'); }
  };
  if (commands[el.dataset.action]) action(commands[el.dataset.action]);
});
$('#save').addEventListener('click', () => action(() => save()));
$('#export-top').addEventListener('click', () => { section = 'export'; render(); window.scrollTo(0, 0); });
$('#open-projects').addEventListener('click', () => action(projectsDialog));
$('#import-file').addEventListener('change', e => action(async () => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  if (file.size > 2_000_000) throw new Error('Project file exceeds the 2 MB limit.');
  const imported = JSON.parse(await file.text()); const config = imported.config || imported;
  if (dirty && !confirm('Save the imported project and replace your current unsaved draft?')) return;
  const doc = await api('/api/projects', 'POST', { config }); await load(doc.id, false); closeDialog(); toast(`Imported and saved "${project.project.name}".`);
}));
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); action(() => save()); } });
render();
const last = localStorage.getItem('picreator-last-project'); if (last) action(async () => { try { await load(last); } catch { localStorage.removeItem('picreator-last-project'); toast('The previous project could not be loaded. Open Projects to choose another.', 'error'); } });

import { lines, words } from '../public/model.js';

// ExecStart arguments are literal argv elements, not shell code or systemd substitutions.
const arg = value => '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%').replaceAll('$', () => '$$').replaceAll('\t', '\\t') + '"';
export function serviceUnit(s, account, prefix = 'project') {
  const extra = lines(s.writablePaths);
  return [
    '[Unit]', `Description=${s.description.replaceAll('%', '%%')}`,
    ...(s.network ? ['Wants=network-online.target', 'After=network-online.target'] : []),
    ...(extra.length ? [`RequiresMountsFor=${extra.join(' ')}`, `Requires=${prefix}-prepare-${s.name}.service`, `After=${prefix}-prepare-${s.name}.service`] : []),
    '', '[Service]', 'Type=exec', `User=${s.account}`, `Group=${s.account}`,
    `ExecStart=${arg(s.executable)}${lines(s.arguments).map(a => ' ' + arg(a)).join('')}`,
    ...(s.workingDirectory ? [`WorkingDirectory=${s.workingDirectory}`] : []),
    `Restart=${s.restart}`, 'RestartSec=5', 'UMask=0077',
    'NoNewPrivileges=yes', 'CapabilityBoundingSet=', 'AmbientCapabilities=',
    'ProtectSystem=strict', 'ProtectHome=yes', 'PrivateTmp=yes',
    `PrivateDevices=${words(account.groups).length ? 'no' : 'yes'}`,
    `PrivateNetwork=${s.network ? 'no' : 'yes'}`,
    'ProtectKernelTunables=yes', 'ProtectKernelModules=yes', 'ProtectControlGroups=yes',
    'RestrictSUIDSGID=yes', 'LockPersonality=yes',
    ...(s.stateDirectory ? [`StateDirectory=${s.stateDirectory}`, 'StateDirectoryMode=0700'] : []),
    ...(s.runtimeDirectory ? [`RuntimeDirectory=${s.runtimeDirectory}`, 'RuntimeDirectoryMode=0700'] : []),
    ...(extra.length ? [`ReadWritePaths=${extra.join(' ')}`] : []),
    'StandardOutput=journal', 'StandardError=journal', '', '[Install]', 'WantedBy=multi-user.target', ''
  ].join('\n');
}

// This root oneshot only creates explicitly selected application data directories.
// It runs after their mounts, including custom empty data partitions.
export function directoryUnit(s, prefix = 'project') {
  const extra = lines(s.writablePaths);
  return ['[Unit]', `Description=Prepare data directories for ${s.name}`, `RequiresMountsFor=${extra.join(' ')}`, '', '[Service]', 'Type=oneshot',
    `ExecStart=/usr/bin/systemd-tmpfiles --create /etc/tmpfiles.d/${prefix}-${s.name}-directories.conf`,
    ''].join('\n');
}

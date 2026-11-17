import { createHash } from 'node:crypto';

const escape = value => String(value).replaceAll('\\','\\\\').replaceAll('\n','\\n').replaceAll('\r','\\r').replaceAll('\t','\\t').replace(/^ +/, spaces => '\\s'.repeat(spaces.length));
// NetworkManager's native keyfile format; no nmcli/chroot rendering required.
export function networkProfile(project, name, args) {
  const a = Object.fromEntries(Array.from({ length: args.length / 2 }, (_,i) => [args[2*i], args[2*i+1]]));
  const hash = createHash('sha256').update(project + ':' + name).digest('hex');
  const uuid = `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
  const wifi = a.type === 'wifi';
  const groups = {
    connection: { id: a['con-name'], uuid, type: wifi ? 'wifi' : 'ethernet', 'interface-name': a.ifname, autoconnect: 'true' },
    ...(wifi ? { wifi: { ssid: a.ssid, mode: 'infrastructure', hidden: a['wifi.hidden'] === 'yes' ? 'true' : 'false' }, 'wifi-security': { 'key-mgmt': a['wifi-sec.key-mgmt'], psk: a['wifi-sec.psk'] } } : { ethernet: {} }),
    ipv4: { method: a['ipv4.method'], ...(a['ipv4.addresses'] ? { address1: a['ipv4.addresses'] + (a['ipv4.gateway'] ? ',' + a['ipv4.gateway'] : '') } : {}), ...(a['ipv4.dns'] ? { dns: a['ipv4.dns'].split(',').join(';') + ';' } : {}) },
    ipv6: { method: a['ipv6.method'] || 'auto' }
  };
  return Object.entries(groups).map(([group, properties]) => `[${group}]\n` + Object.entries(properties).map(([key,value]) => `${key}=${escape(value)}`).join('\n')).join('\n\n') + '\n';
}

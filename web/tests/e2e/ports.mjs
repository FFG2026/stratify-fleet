// Stops whatever is listening on a TCP port (Linux). The browser test uses unusual ports so this only ever hits its own leftovers.
import { readFileSync, readdirSync, readlinkSync } from 'node:fs';
export function killListener(port) {
  const hex = port.toString(16).toUpperCase().padStart(4, '0');
  const inodes = new Set();
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    try {
      for (const line of readFileSync(file, 'utf8').split('\n').slice(1)) {
        const f = line.trim().split(/\s+/);
        if (f[3] === '0A' && f[1]?.endsWith(':' + hex)) inodes.add(f[9]);
      }
    } catch { /* no ipv6 */ }
  }
  if (!inodes.size) return [];
  const killed = [];
  for (const pid of readdirSync('/proc').filter(d => /^\d+$/.test(d))) {
    try {
      for (const fd of readdirSync(`/proc/${pid}/fd`)) {
        const link = readlinkSync(`/proc/${pid}/fd/${fd}`);
        const m = /^socket:\[(\d+)\]$/.exec(link);
        if (m && inodes.has(m[1]) && Number(pid) !== process.pid) { process.kill(Number(pid), 'SIGTERM'); killed.push(pid); break; }
      }
    } catch { /* process gone or not ours */ }
  }
  return killed;
}

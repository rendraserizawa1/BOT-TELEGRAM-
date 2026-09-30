'use strict';
// Baca config PM2 yang sedang aktif untuk app telegram-perabot (via pm2 jlist).
const { execFileSync } = require('child_process');
const path = require('path');

const pm2cmd = path.join(process.env.APPDATA, 'npm', 'pm2.cmd');
let raw;
try {
  raw = execFileSync('cmd.exe', ['/c', pm2cmd, 'jlist'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
} catch (e) {
  console.error('GAGAL jalankan pm2 jlist:', e.message);
  process.exit(1);
}
raw = raw.slice(raw.indexOf('['));
const list = JSON.parse(raw);
const app = list.find((a) => a.name === 'telegram-perabot');
if (!app) {
  console.error('App telegram-perabot tidak ditemukan di PM2');
  process.exit(1);
}
const e = app.pm2_env;
console.log(JSON.stringify({
  pid: app.pid,
  status: e.status,
  restarts: e.restart_time,
  max_memory_restart: e.max_memory_restart,
  node_args: e.node_args,
  kill_timeout: e.kill_timeout,
  exp_backoff_restart_delay: e.exp_backoff_restart_delay,
  min_uptime: e.min_uptime,
  max_restarts: e.max_restarts,
}, null, 2));

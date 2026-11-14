// test-poll-keepalive.js
// Membuktikan poller memakai ULANG koneksi TCP ke api.telegram.org
// (bukan membuka socket + handshake TLS baru setiap poll).
// Cara ukur: hitung jumlah koneksi ESTABLISHED ke 149.154.x / api.telegram.org
// pada beberapa sampel. Dengan keep-alive, jumlahnya harus tetap kecil (1-2),
// bukan bertambah tiap poll.
'use strict';
const { execFileSync } = require('child_process');

function hitungKoneksi() {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `$c = Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | Where-Object { $_.RemoteAddress -like '149.154.*' -or $_.RemoteAddress -like '91.108.*' }; if($c){ ($c | Measure-Object).Count } else { 0 }`,
    ], { encoding: 'utf8', timeout: 30000 });
    return parseInt(String(out).trim(), 10) || 0;
  } catch (e) { return -1; }
}

function hitungSocketProses(pid) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `$c = Get-NetTCPConnection -State Established -OwningProcess ${pid} -ErrorAction SilentlyContinue; if($c){ ($c | Measure-Object).Count } else { 0 }`,
    ], { encoding: 'utf8', timeout: 30000 });
    return parseInt(String(out).trim(), 10) || 0;
  } catch (e) { return -1; }
}

const http = require('http');
function health() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: 3001, path: '/health', timeout: 60000 }, (res) => {
      let b = ''; res.setEncoding('utf8');
      res.on('data', (d) => { b += d; });
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

(async () => {
  const h0 = await health();
  if (!h0) { console.log('health tidak merespons'); process.exit(2); }
  const pid = h0.pid;
  console.log(`pid=${pid} memantau koneksi Telegram selama 150 dtk\n`);
  console.log('waktu     telegram_conn  socket_bot  pollAgo  streak');

  const t0 = Date.now();
  const jumlah = [];
  while (Date.now() - t0 < 150000) {
    const tg = hitungKoneksi();
    const sb = hitungSocketProses(pid);
    const h = await health();
    if (tg >= 0) jumlah.push(tg);
    console.log(
      `${new Date().toTimeString().slice(0, 8)}  ${String(tg).padStart(12)}  ${String(sb).padStart(10)}  ` +
      `${String(h ? h.telegramLastPollAgoSec ?? '-' : '?').padStart(7)}  ${String(h ? h.telegramPollErrorStreak : '?').padStart(6)}`
    );
    await new Promise((r) => setTimeout(r, 15000));
  }

  const max = jumlah.length ? Math.max(...jumlah) : -1;
  const avg = jumlah.length ? jumlah.reduce((a, b) => a + b, 0) / jumlah.length : -1;
  console.log(`\nkoneksi Telegram: max=${max} rata2=${avg.toFixed(1)} sampel=${jumlah.length}`);
  // Keep-alive yang benar: koneksi tetap 1-2 (long-poll selalu satu socket).
  const lulus = max >= 0 && max <= 3;
  console.log(lulus ? 'LULUS: koneksi dipakai ulang (keep-alive bekerja)' : 'PERIKSA: koneksi bertambah (kemungkinan tidak reuse)');
  process.exit(lulus ? 0 : 1);
})();

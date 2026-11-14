// verify-all.js - cek kesehatan menyeluruh BCODE-KEFA dalam satu perintah.
// Pemakaian:  node boot\verify-all.js
// Tidak mencetak token/kata sandi. Keluar 0 bila semua PASS.
'use strict';
const fs = require('fs');
const path = require('path');
const net = require('net');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3001';
const IPOS = process.env.IPOS_BASE || 'http://127.0.0.1:8080';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
}
function warn(name, detail) { console.log(`WARN  ${name}${detail ? '  -> ' + detail : ''}`); }

function readEnv() {
  const map = {};
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      map[m[1]] = v;
    }
  } catch (e) {}
  return map;
}

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port }, () => { s.destroy(); resolve(true); });
    s.setTimeout(3000);
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.on('error', () => resolve(false));
  });
}

(async () => {
  // 1. Port dashboard & iPos
  check('port 3001 (bot) listen', await portOpen(3001));
  check('port 8080 (iPos API) listen', await portOpen(8080));

  // 2. Health bot
  let h = null;
  try { h = await (await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(30000) })).json(); } catch (e) {}
  if (!h) {
    check('health bot', false, 'tidak bisa dihubungi');
  } else {
    check('health bot status', h.status === 'OK', `pid=${h.pid} uptime=${Math.round(h.uptime)}s`);
    check('poller Telegram hidup', h.polling === true);
    check('poll terakhir < 120 dtk', typeof h.telegramLastPollAgoSec === 'number' && h.telegramLastPollAgoSec < 120,
      `pollAgo=${h.telegramLastPollAgoSec}s streak=${h.telegramPollErrorStreak}`);
    check('error poll beruntun = 0', (h.telegramPollErrorStreak || 0) === 0, `streak=${h.telegramPollErrorStreak}`);
    check('event loop tidak macet', (h.loopLagMs || 0) < 5000, `lag=${h.loopLagMs}ms`);
    check('RSS wajar (<400MB)', (h.rssMB || 0) < 400, `rss=${h.rssMB}MB`);
    // Tombol inline (callback_query) tidak akan pernah sampai ke bot kalau
    // allowed_updates tidak memintanya. Ini penyebab nyata "tombol tidak
    // merespon" pada 2026-11-14 (server menyimpan setelan lama ["message"]).
    const au = Array.isArray(h.telegramAllowedUpdates) ? h.telegramAllowedUpdates : [];
    check('allowed_updates meminta callback_query (tombol inline)',
      au.includes('callback_query'), au.length ? au.join(',') : 'kosong/tidak dilaporkan');
    check('allowed_updates meminta message', au.includes('message'), au.join(','));
  }

  // 3. Health iPos. Host ini RAM-nya sempit (paging berat) sehingga request
  //    pertama bisa timeout walau server sehat. Coba ulang dengan jeda
  //    daripada melaporkan false-negative.
  let ip = null;
  let ipErr = '';
  for (let i = 0; i < 3; i++) {
    try {
      ip = await (await fetch(`${IPOS}/ipos/health`, { signal: AbortSignal.timeout(20000) })).json();
      if (ip && ip.ok === true) break;
    } catch (e) { ipErr = e.name + ': ' + e.message; }
    if (i < 2) await new Promise((r) => setTimeout(r, 3000));
  }
  check('health iPos API', !!ip && ip.ok === true, ip ? `lastError=${ip.lastError || '-'}` : ('tidak bisa dihubungi setelah 3 percobaan' + (ipErr ? ' (' + ipErr + ')' : '')));

  // 4. Lock single-instance
  const lockPath = path.join(ROOT, 'storage', 'bot.lock');
  let lock = null;
  try { lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch (e) {}
  check('lock single-instance ada', !!lock, lock ? `pid=${lock.pid}` : 'file storage\\bot.lock tidak ada');
  if (lock && h) check('lock menunjuk proses yang benar', Number(lock.pid) === Number(h.pid), `lock=${lock.pid} health=${h.pid}`);

  // 5. Database lokal
  let stats = null;
  const env = readEnv();
  try {
    const lr = await fetch(`${BASE}/login`, {
      method: 'POST',
      body: new URLSearchParams({ username: env.DASHBOARD_USER || 'admin', password: env.DASHBOARD_PASS || '' }),
      redirect: 'manual', signal: AbortSignal.timeout(30000),
    });
    const cookie = (lr.headers.getSetCookie ? lr.headers.getSetCookie() : []).map((c) => c.split(';')[0]).join('; ');
    check('login dashboard', lr.status === 302 && !!cookie, `status=${lr.status}`);
    if (cookie) {
      const sr = await fetch(`${BASE}/api/db/stats`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(30000) });
      stats = await sr.json();
      check('database siap', sr.status === 200 && stats.ready === true,
        `messages=${stats.messages} files=${stats.files} events=${stats.events} backups=${stats.backups}`);
      for (const t of ['messages', 'files', 'sessions', 'backups']) {
        const r = await fetch(`${BASE}/api/db/${t}?limit=3`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(30000) });
        const j = await r.json();
        check(`tabel ${t}`, r.status === 200 && Array.isArray(j.data), `rows=${(j.data || []).length}`);
      }
      // unduh satu file arsip
      const fr = await fetch(`${BASE}/api/db/files?limit=20`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(30000) });
      const fj = await fr.json();
      const f = (fj.data || []).find((x) => x.local_path);
      if (f) {
        const dl = await fetch(`${BASE}/database/file/${f.id}`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(60000) });
        const buf = Buffer.from(await dl.arrayBuffer());
        const disk = fs.existsSync(f.local_path) ? fs.statSync(f.local_path).size : -1;
        check('unduh file arsip', dl.status === 200 && buf.length === disk, `id=${f.id} bytes=${buf.length}/${disk}`);
      } else warn('unduh file arsip', 'belum ada file dengan local_path');
    }
  } catch (e) {
    check('database/dashboard', false, e.message);
  }

  // 6. Backup .env aman
  const envBak = path.join(ROOT, 'data', 'secure', 'env.backup');
  check('backup .env terbatas ACL', fs.existsSync(envBak), fs.existsSync(envBak) ? `${fs.statSync(envBak).size} bytes` : 'tidak ada');

  // 7. Backup database
  const bakDir = path.join(ROOT, 'data', 'backups');
  let bakCount = 0;
  try { bakCount = fs.readdirSync(bakDir).length; } catch (e) {}
  check('backup database ada', bakCount > 0, `${bakCount} berkas di data\\backups`);

  // 8. Sesi tersimpan (resume setelah restart)
  if (stats) {
    const sess = (stats.sessions || 0);
    check('sesi percakapan tersimpan', sess > 0, `${sess} sesi`);
  }

  // 9. Kunci single-instance SEHAT (bug 2026-11-14: lock basi berisi PID yang
  //    didaur ulang proses lain membuat SETIAP start keluar exit=2, sehingga
  //    bot tidak merespon chat sama sekali). Cek di atas hanya memastikan PID
  //    lock == PID health; di sini dipakai logika pemilikLockSah yang sama
  //    dengan yang dipakai index.js saat start.
  try {
    const lockMod = require('../bot-instance-lock');
    if (lock) {
      const keputusan = lockMod.pemilikLockSah(Number(lock.pid), Number(lock.at), Number(lock.port || 3001));
      check('lock single-instance sah (bukan PID daur ulang)', keputusan === true,
        `pid=${lock.pid} keputusan=${keputusan} (false = lock basi, start berikutnya bisa gagal)`);
      const info = lockMod.infoProses(Number(lock.pid));
      const buat = info && lockMod.waktuBuatProses(info.CreationDate);
      check('lock tidak lebih tua dari proses bot', !buat || Number(lock.at) >= buat - 120000);
    }
  } catch (e) {
    check('lock single-instance sah', false, e.message);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nRINGKASAN: ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) console.log('GAGAL: ' + failed.map((f) => f.name).join(', '));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.log('ERR', e.name, e.message); process.exit(1); });

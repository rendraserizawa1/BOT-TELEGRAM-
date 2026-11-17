'use strict';
/**
 * BUKTI KESETIAAN (faithfulness) ANGKA `update` + UKUR SELISIH JAM YANG BENAR.
 *
 * DUA HAL YANG DIUKUR, DAN KENAPA DIPISAH
 * ---------------------------------------
 * 1. KESETIAAN: nilai `update` yang DIPAKAI BOT harus SAMA PERSIS dengan nilai
 *    yang DIKIRIM AGEN. Kalau berbeda, bridge mengubah/mengarang angka — itu
 *    bug. Perbandingan ini tidak terpengaruh waktu, jadi tidak bisa salah
 *    hanya karena pengambilan data berurutan.
 *
 * 2. KESEGARAN: nilai yang dikirim agen harus berada dalam rentang
 *    [sumber_sebelum, sumber_sesudah]. Kalau di luar rentang, berarti agen
 *    menyimpan angka lama.
 *
 * 3. SELISIH JAM: diukur dari `lastSync` /health proxy, yaitu waktu MESIN TOKO
 *    saat ia menyegarkan katalog (bergerak tiap detik), BUKAN dari `update`
 *    laporan. Memakai `update` untuk mengukur jam adalah kesalahan: laporan
 *    yang beku akan tampak seperti jam yang mundur. (Kesalahan ini sempat
 *    terjadi di versi pertama skrip ini.)
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const BOOT = __dirname;
const ROOT = path.join(__dirname, '..');
for (const berkas of [path.join(BOOT, 'push-agen.env'), path.join(ROOT, '.env')]) {
  let isi; try { isi = fs.readFileSync(berkas, 'utf8'); } catch (_) { continue; }
  for (const baris of isi.split(/\r?\n/)) {
    const m = baris.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const TOKO = [
  { id: 'cp', url: process.env.IPOS_URL, key: process.env.IPOS_KEY },
  { id: 'nk', url: process.env.IPOS_NK_URL, key: process.env.IPOS_NK_KEY },
  { id: 'kefa', url: process.env.IPOS_KEFA_URL, key: process.env.IPOS_KEFA_KEY },
].filter((t) => t.url && t.key);

const tglLokal = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));

function json(url, timeout) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: 'GET' }, (res) => {
      const p = []; res.on('data', (d) => p.push(d));
      res.on('end', () => {
        const b = Buffer.concat(p).toString('utf8');
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        try { resolve(JSON.parse(b)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout || 90000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

/**
 * Ubah `lastSync` proxy menjadi epoch ms.
 *
 * PENTING: bentuknya BEDA ANTAR BUILD PROXY, dan ini bukan hal sepele.
 *   KEFA : string ISO  -> "2026-11-17T01:58:07.729Z"
 *   CP   : angka epoch ms -> 1794880687729
 *   NK   : angka epoch ms
 * `Number("2026-11-17T...")` menghasilkan NaN, dan NaN membuat perhitungan
 * selisih jam tampak seperti "jam berbeda" padahal hanya bentuknya lain.
 * Bot sendiri TIDAK mem-parse nilai ini (ipos-bridge memakai Date.now()
 * internal), jadi ini murni urusan alat ukur.
 */
function keEpochMs(v) {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'number') return v;
  const teks = String(v).trim();
  if (/^\d+$/.test(teks)) return Number(teks);
  const t = Date.parse(teks);
  return Number.isFinite(t) ? t : NaN;
}

(async () => {
  const hari = tglLokal();
  console.log('=== kesetiaan angka laporan + selisih jam mesin ===');
  console.log('  tanggal ' + hari);
  console.log('');

  // ── A. selisih jam, diukur dari lastSync (waktu mesin toko) ──────────
  console.log('--- A. selisih jam mesin tiap toko (dari /health lastSync) ---');
  for (const t of TOKO) {
    try {
      const h = await json(t.url + '/health?key=' + encodeURIComponent(t.key), 20000);
      const ls = keEpochMs(h.lastSync);
      const selisih = Math.round((ls - Date.now()) / 1000);
      const bentuk = typeof h.lastSync === 'number' ? 'angka' : 'ISO';
      console.log('  ' + t.id.toUpperCase().padEnd(5) + ' lastSync ' + (selisih >= 0 ? '+' : '') + selisih
        + ' dtk terhadap PC ini  (bentuk ' + bentuk + ', ' + (Math.abs(selisih) <= 120 ? 'jam SEJAJAR' : 'jam BERBEDA') + ')');
    } catch (e) { console.log('  ' + t.id.toUpperCase() + ' /health GAGAL: ' + e.message); }
  }

  // ── B. sumber: jual SEBELUM agen ────────────────────────────────────
  console.log('');
  console.log('--- B. jalankan agen sungguhan, tangkap nilai yang dikirim ---');
  const diterima = new Map();
  const gudang = require('./push-gudang');
  const server = http.createServer((req, res) => {
    const p = [];
    req.on('data', (d) => p.push(d));
    req.on('end', () => {
      let j = null;
      try { j = JSON.parse(Buffer.concat(p).toString('utf8')); } catch (_) { /* bukan json */ }
      if (j && j.toko && j.jenis) {
        diterima.set(j.toko + '|' + j.jenis, j.data);
        gudang.terima(j, req.headers['x-push-token']);
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, perluPenuh: false }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const sebelum = {};
  for (const t of TOKO) {
    try {
      const j = await json(t.url + '/api/jual?dari=' + hari + '&sampai=' + hari + '&key=' + encodeURIComponent(t.key), 90000);
      sebelum[t.id] = Number(j.update);
    } catch (e) { sebelum[t.id] = null; }
  }

  const anak = spawn(process.execPath, [path.join(BOOT, 'push-agen.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PUSH_URL: 'http://127.0.0.1:' + port,
      PUSH_TOKO: TOKO.map((t) => t.id).join(','),
      PUSH_LOCK_FILE: path.join(os.tmpdir(), 'kesetiaan.lock'),
      PUSH_STATUS_FILE: path.join(os.tmpdir(), 'kesetiaan-status.json'),
      PUSH_JEDA_STOK_MS: '600000', PUSH_JEDA_STOK_MS_CP: '600000',
      PUSH_JEDA_STOK_MS_NK: '600000', PUSH_JEDA_DENYUT_MS: '600000',
    },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let log = '';
  anak.stdout.on('data', (d) => { log += d.toString(); });
  anak.stderr.on('data', (d) => { log += d.toString(); });

  const perlu = [];
  for (const t of TOKO) perlu.push(t.id + '|jual');
  const mulai = Date.now();
  while (Date.now() - mulai < 200000) {
    if (perlu.every((k) => diterima.has(k))) break;
    if (anak.exitCode !== null) break;
    await tunggu(400);
  }
  anak.kill();
  await tunggu(400);
  server.close();

  const sesudah = {};
  for (const t of TOKO) {
    try {
      const j = await json(t.url + '/api/jual?dari=' + hari + '&sampai=' + hari + '&key=' + encodeURIComponent(t.key), 90000);
      sesudah[t.id] = Number(j.update);
    } catch (e) { sesudah[t.id] = null; }
  }

  if (perlu.some((k) => !diterima.has(k))) {
    console.log('  agen tidak mengirim semua laporan. log:');
    console.log(log.slice(-1200));
    process.exit(1);
  }

  // ── C. nilai yang DIPAKAI BOT ───────────────────────────────────────
  delete require.cache[require.resolve('../ipos-bridge')];
  const bridge = require('../ipos-bridge');

  console.log('');
  console.log('--- C. perbandingan ---');
  let gagal = 0;
  for (const t of TOKO) {
    const kirim = diterima.get(t.id + '|jual');
    const uKirim = Number(kirim && kirim.update);
    const inst = bridge[t.id];
    let uBot = null, err = null;
    try { uBot = Number((await inst.ambilLaporanKasir(hari, hari, { fresh: true })).update); }
    catch (e) { err = e.message; }

    const s1 = sebelum[t.id], s2 = sesudah[t.id];
    const lo = Math.min(s1 || 0, s2 || 0), hi = Math.max(s1 || 0, s2 || 0);
    const setia = uBot !== null && uBot === uKirim;
    const dalamRentang = uKirim >= lo && uKirim <= hi;

    console.log('  ' + t.id.toUpperCase());
    console.log('     sumber  : sebelum=' + s1 + '  sesudah=' + s2 + (s1 === s2 ? '  (TIDAK bergerak)' : '  (bergerak +' + (s2 - s1) + ' ms)'));
    console.log('     agen    : ' + uKirim + '   dalam rentang sumber: ' + (dalamRentang ? 'YA' : 'TIDAK'));
    console.log('     bot     : ' + (err ? 'ERROR ' + err : uBot) + '   SAMA PERSIS dgn agen: ' + (setia ? 'YA' : 'TIDAK'));
    if (!setia || !dalamRentang) gagal++;
    console.log('');
  }

  // ── D. laporan beku: harus DITANDAI, bukan disembunyikan ────────────
  console.log('--- D. laporan beku di sumber: apakah bot jujur menandainya? ---');
  for (const t of TOKO) {
    const s1 = sebelum[t.id], s2 = sesudah[t.id];
    const umur = s2 ? Math.round((Date.now() - s2) / 1000) : null;
    const beku = s1 !== null && s2 !== null && s1 === s2;
    console.log('  ' + t.id.toUpperCase().padEnd(5) + ' umur laporan sumber = ' + umur + ' dtk'
      + (beku ? '   <== SUMBER TIDAK MEMPERBARUI (beku)' : '   (hidup, memperbarui)'));
  }

  console.log('');
  if (gagal) { console.log('  ADA ' + gagal + ' toko yang angkanya TIDAK setia -> BUG'); process.exit(1); }
  console.log('  SEMUA angka bot SAMA PERSIS dengan yang dikirim agen, dan agen mengirim nilai sumber yang sah.');
  process.exit(0);
})().catch((e) => { console.log('FATAL: ' + ((e && e.stack) || e)); process.exit(1); });

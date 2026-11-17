'use strict';
/**
 * UJI RANTAI PENUH DENGAN DATA ASLI: permintaan tanggal lampau -> PC menjemput
 * -> laporan tersedia di bot.
 *
 * Kenapa uji ini perlu, padahal sudah ada uji unit:
 * uji unit memakai data tiruan. Yang bisa salah justru sambungannya — apakah
 * agen benar-benar menjemput pesanan dari endpoint server, mengambil laporan
 * dari proxy toko yang SUNGGUHAN, dan mengirimnya kembali sehingga bot bisa
 * menyajikannya. Itu hanya terbukti dengan rantai penuh.
 *
 * YANG DIPAKAI
 *   - proxy toko sungguhan (lewat push-agen.env, tanpa mencetak rahasia)
 *   - agen sungguhan (push-agen.js)
 *   - penerima sungguhan (push-penerima lewat push-gudang)
 *   - bridge sungguhan (ipos-bridge)
 *
 * Alamat PUSH_URL diarahkan ke penerima tiruan lokal, jadi tidak ada data uji
 * yang masuk ke Railway.
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const BOOT = __dirname;
const ROOT = path.join(__dirname, '..');

function muatEnv() {
  for (const berkas of [path.join(BOOT, 'push-agen.env'), path.join(ROOT, '.env')]) {
    let isi;
    try { isi = fs.readFileSync(berkas, 'utf8'); } catch (_) { continue; }
    for (const baris of isi.split(/\r?\n/)) {
      const m = baris.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}
muatEnv();

const TOKEN = process.env.PUSH_TOKEN;
const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));

let lulus = 0;
let gagal = 0;
function cek(nama, syarat, detail) {
  if (syarat) { lulus++; console.log('  OK   ' + nama); }
  else { gagal++; console.log('  GAGAL ' + nama + (detail ? ' -> ' + detail : '')); }
}

(async () => {
  if (!TOKEN) { console.log('FATAL: PUSH_TOKEN tidak ada'); process.exit(1); }
  if (!process.env.IPOS_KEY) { console.log('FATAL: IPOS_KEY tidak ada'); process.exit(1); }

  // Toko yang diuji: CP, karena inilah yang dilaporkan pengguna.
  const TGL = process.env.TGL_UJI || '2026-11-14';

  console.log('=== uji rantai penuh: permintaan tanggal lampau -> PC -> bot ===');
  console.log('  toko cp, tanggal ' + TGL);
  console.log('');

  // Penerima tiruan: meniru endpoint Railway, memakai modul penerima SUNGGUHAN.
  const gudang = require('./push-gudang');
  const diterima = [];
  const server = http.createServer((req, res) => {
    const potong = [];
    req.on('data', (d) => potong.push(d));
    req.on('end', () => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/api/ipos/perlu') {
        // Inilah endpoint yang dijemput PC di produksi.
        const toko = String(url.searchParams.get('toko') || '').toLowerCase();
        const tokenDikirim = req.headers['x-push-token'];
        if (String(tokenDikirim || '') !== TOKEN) {
          res.writeHead(401, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, err: 'token salah' }));
        }
        const daftar = gudang.jemputPermintaan(toko);
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, toko, permintaan: daftar }));
      }
      if (req.method === 'POST' && url.pathname === '/api/ipos/push') {
        let j = null;
        try { j = JSON.parse(Buffer.concat(potong).toString('utf8')); } catch (_) { j = null; }
        if (j && j.toko && j.jenis) {
          diterima.push({ toko: j.toko, jenis: j.jenis, dari: j.data && j.data.dari, sampai: j.data && j.data.sampai });
          gudang.terima(j, req.headers['x-push-token']);
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, perluPenuh: false }));
      }
      res.writeHead(404); res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const anak = spawn(process.execPath, [path.join(BOOT, 'push-agen.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PUSH_URL: 'http://127.0.0.1:' + port,
      PUSH_TOKO: 'cp',
      PUSH_LOCK_FILE: path.join(os.tmpdir(), 'uji-rantai.lock'),
      PUSH_STATUS_FILE: path.join(os.tmpdir(), 'uji-rantai-status.json'),
      // Matikan pengiriman berkala supaya yang teruji hanya jalur pesanan.
      PUSH_JEDA_STOK_MS: '600000', PUSH_JEDA_STOK_MS_CP: '600000',
      PUSH_JEDA_DENYUT_MS: '600000', PUSH_JEDA_PENUH_MS: '600000',
      PUSH_JEDA_PERMINTAAN_MS: '300',
    },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let log = '';
  anak.stdout.on('data', (d) => { log += d.toString(); });
  anak.stderr.on('data', (d) => { log += d.toString(); });

  // Tunggu katalog awal (bukti agen sudah siap).
  const mulai = Date.now();
  while (Date.now() - mulai < 180000) {
    if (diterima.some((x) => x.jenis === 'items')) break;
    if (anak.exitCode !== null) break;
    await tunggu(300);
  }
  cek('agen siap (katalog CP terkirim)', diterima.some((x) => x.jenis === 'items'),
    'exitCode=' + anak.exitCode);

  // ── INTI UJI: minta laporan tanggal lampau lewat BRIDGE ──────────────
  // Ini yang dilakukan bot ketika pengguna mengetik 14/11/2026.
  const bridge = require('../ipos-bridge');
  const janji = bridge.cp.ambilLaporanMarketplace(TGL, TGL);

  // Bridge akan menunggu sebentar (PUSH_TUNGGU_RENTANG_MS) sementara PC
  // menjemput pesanannya. Beri waktu cukup.
  let hasil = null;
  let galat = null;
  try { hasil = await janji; } catch (e) { galat = e; }

  cek('laporan ' + TGL + ' BERHASIL diambil (tidak kosong, tidak error)',
    !galat && !!hasil, galat && galat.message);

  if (hasil) {
    console.log('       central.nota   = ' + (hasil.central && hasil.central.nota));
    console.log('       central.omzet  = ' + (hasil.central && hasil.central.omzet));
    console.log('       dari/sampai    = ' + hasil.dari + ' .. ' + hasil.sampai);
    cek('rentangnya persis yang diminta', hasil.dari === TGL && hasil.sampai === TGL,
      hasil.dari + '..' + hasil.sampai);
    cek('berisi nota (bukan nol)', !!(hasil.central && hasil.central.nota > 0),
      hasil.central && hasil.central.nota);
    cek('omzetnya masuk akal (> 0)', !!(hasil.central && hasil.central.omzet > 0),
      hasil.central && hasil.central.omzet);
    cek('berbentuk laporan marketplace, bukan kasir',
      !!(hasil.central && Array.isArray(hasil.central.notas)) && !Array.isArray(hasil.kasir));
    cek('PC benar-benar mengirim rentang itu',
      diterima.some((x) => x.jenis === 'jual-marketplace' && x.dari === TGL),
      JSON.stringify(diterima.filter((x) => x.jenis === 'jual-marketplace')));
  }

  // Permintaan kedua untuk tanggal yang sama harus dilayani dari gudang,
  // tanpa meminta ke PC lagi (murah & cepat).
  const sebelum = diterima.filter((x) => x.jenis === 'jual-marketplace' && x.dari === TGL).length;
  let hasil2 = null;
  try { hasil2 = await bridge.cp.ambilLaporanMarketplace(TGL, TGL); } catch (_) { hasil2 = null; }
  const sesudah = diterima.filter((x) => x.jenis === 'jual-marketplace' && x.dari === TGL).length;
  cek('permintaan kedua tetap tersedia', !!hasil2 && hasil2.central && hasil2.central.nota > 0);
  cek('permintaan kedua TIDAK meminta ulang ke PC', sesudah === sebelum,
    'sebelum=' + sebelum + ' sesudah=' + sesudah);

  anak.kill();
  await tunggu(300);
  server.close();

  console.log('');
  console.log('=== RINGKASAN ===');
  console.log('  lulus: ' + lulus + '   gagal: ' + gagal);
  if (gagal) {
    console.log('  --- log agen (akhir) ---');
    console.log(log.slice(-1200));
    process.exit(1);
  }
  console.log('  SEMUA LULUS');
  process.exit(0);
})().catch((e) => { console.log('FATAL: ' + ((e && e.stack) || e)); process.exit(1); });

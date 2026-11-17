'use strict';
/**
 * UJI AGEN TIGA TOKO — memakai penerima TIRUAN di localhost.
 *
 * KENAPA TIRUAN, BUKAN RAILWAY
 * ----------------------------
 * Kalau uji ini menembak Railway sungguhan, kegagalan konfigurasi akan
 * mengotori data produksi dan sulit dibedakan dari gangguan jaringan. Dengan
 * penerima tiruan, yang diuji HANYA perilaku agen: apakah ia benar-benar
 * menemukan ketiga toko, menarik katalognya, dan mengirimkannya.
 *
 * Yang dibuktikan:
 *   1. daftarToko menemukan cp, nk, DAN kefa (dulu hanya kefa).
 *   2. Katalog ketiga toko benar-benar terkirim, dengan jumlah item wajar.
 *   3. Laporan jual, merek, dan marketplace ikut terkirim.
 *   4. Agen tidak berhenti karena satu toko lambat.
 */
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const DETIK_MAKS = Number(process.env.UJI_DETIK_MAKS || 150);

const diterima = [];
let bytesTotal = 0;

const server = http.createServer((req, res) => {
  const potong = [];
  req.on('data', (d) => potong.push(d));
  req.on('end', () => {
    const badan = Buffer.concat(potong);
    bytesTotal += badan.length;
    let j = null;
    try { j = JSON.parse(badan.toString('utf8')); } catch (_) { /* bukan json */ }
    if (j && j.toko && j.jenis) {
      diterima.push({
        toko: j.toko,
        jenis: j.jenis,
        jumlah: Array.isArray(j.data) ? j.data.length : null,
        bytes: badan.length,
        dari: j.data && j.data.dari ? j.data.dari : null,
        sampai: j.data && j.data.sampai ? j.data.sampai : null,
      });
      console.log('  <- ' + String(j.toko).padEnd(5) + ' ' + String(j.jenis).padEnd(18)
        + (Array.isArray(j.data) ? j.data.length + ' item' : 'laporan')
        + '  ' + Math.round(badan.length / 1024) + ' KB');
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, perluPenuh: false }));
  });
});

const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  console.log('=== uji agen tiga toko (penerima tiruan di :' + port + ') ===');

  const env = {
    ...process.env,
    PUSH_URL: 'http://127.0.0.1:' + port,
    PUSH_TOKEN: 'token-uji-agen',
    PUSH_LOCK_FILE: path.join(require('os').tmpdir(), 'uji-agen-tiga-toko.lock'),
    PUSH_STATUS_FILE: path.join(require('os').tmpdir(), 'uji-agen-tiga-toko-status.json'),
    PUSH_TOKO: process.env.PUSH_TOKO || 'cp,nk,kefa',
    // Jangan biarkan pewaktu apa pun memperpanjang uji.
    PUSH_JEDA_STOK_MS: '600000',
    PUSH_JEDA_STOK_MS_CP: '600000',
    PUSH_JEDA_STOK_MS_NK: '600000',
    PUSH_JEDA_DENYUT_MS: '600000',
  };

  const anak = spawn(process.execPath, [path.join(__dirname, 'push-agen.js')], {
    cwd: path.join(__dirname, '..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let log = '';
  anak.stdout.on('data', (d) => { log += d.toString(); });
  anak.stderr.on('data', (d) => { log += d.toString(); });

  const target = ['cp', 'nk', 'kefa'];
  const sudah = () => new Set(diterima.filter((x) => x.jenis === 'items').map((x) => x.toko));
  const mulai = Date.now();
  while (Date.now() - mulai < DETIK_MAKS * 1000) {
    if (target.every((t) => sudah().has(t))) break;
    if (anak.exitCode !== null) break;
    await tunggu(500);
  }
  // Beri waktu untuk laporan (dikirim setelah katalog awal).
  await tunggu(6000);

  anak.kill();
  await tunggu(500);
  server.close();

  console.log('');
  console.log('=== HASIL ===');
  let gagal = 0;
  const cek = (nama, syarat, detail) => {
    if (syarat) { console.log('  OK    ' + nama); }
    else { gagal++; console.log('  GAGAL ' + nama + (detail ? ' -> ' + detail : '')); }
  };

  const set = sudah();
  cek('katalog cp terkirim', set.has('cp'), 'yang terkirim: ' + [...set].join(','));
  cek('katalog nk terkirim', set.has('nk'), 'yang terkirim: ' + [...set].join(','));
  cek('katalog kefa terkirim', set.has('kefa'), 'yang terkirim: ' + [...set].join(','));

  for (const t of target) {
    const it = diterima.find((x) => x.toko === t && x.jenis === 'items');
    cek(t + ' katalog berisi >1000 item', !!it && it.jumlah > 1000, it ? String(it.jumlah) : 'tidak ada');
  }

  for (const t of target) {
    const j = diterima.find((x) => x.toko === t && x.jenis === 'jual');
    cek(t + ' laporan jual terkirim', !!j, 'tidak ada');
    if (j) cek(t + ' laporan jual menyertakan dari/sampai', !!j.dari && !!j.sampai, JSON.stringify({ dari: j.dari, sampai: j.sampai }));
  }

  for (const t of target) {
    cek(t + ' laporan merek terkirim', !!diterima.find((x) => x.toko === t && x.jenis === 'jual-merek'));
    cek(t + ' laporan marketplace terkirim', !!diterima.find((x) => x.toko === t && x.jenis === 'jual-marketplace'));
  }

  cek('agen tidak keluar sendiri', anak.exitCode === null || anak.exitCode === 0,
    'exitCode=' + anak.exitCode);

  console.log('');
  console.log('  total diterima: ' + diterima.length + ' kiriman, ' + Math.round(bytesTotal / 1024) + ' KB');
  if (gagal) {
    console.log('');
    console.log('--- log agen (2000 char terakhir) ---');
    console.log(log.slice(-2000));
    console.log('  ADA YANG GAGAL (' + gagal + ')');
    process.exit(1);
  }
  console.log('  SEMUA LULUS');
  process.exit(0);
})().catch((e) => {
  console.log('FATAL: ' + ((e && e.stack) || e));
  process.exit(1);
});

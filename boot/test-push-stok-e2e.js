'use strict';
/**
 * UJI END-TO-END: agen mendeteksi perubahan STOK tanpa bantuan frame SSE.
 *
 * KENAPA UJI INI ADA
 * ------------------
 * Proxy iPos yang asli punya cacat terukur: ia TIDAK PERNAH menyiarkan frame
 * `items` saat stok berubah, karena perbandingannya tidak menyertakan `stok`
 * dan berjalan sebelum stok diisi. Dibuktikan dengan probe SSE 31 menit:
 * 3 frame `jual` masuk, frame `items` NOL.
 *
 * Jadi memperbaiki sisi agen saja tidak cukup untuk dipercaya â€” harus
 * DIBUKTIKAN bahwa agen benar-benar mengirim delta stok ketika SSE diam.
 *
 * Uji ini meniru kondisi itu dengan sengaja:
 *   - proxy tiruan: /api/events HANYA mengirim `hello` + ping, TIDAK PERNAH
 *     `items` (persis cacat proxy asli)
 *   - stok diubah di proxy tiruan
 *   - penerima tiruan mencatat setiap kiriman
 *
 * Kalau agen masih bergantung pada frame SSE, uji ini GAGAL. Itu memang
 * tujuannya.
 *
 * Tidak menyentuh data toko sungguhan sama sekali.
 */
const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

let lulus = 0, gagal = 0;
const uji = (nama, ok, info) => {
  if (ok) { lulus++; console.log('  OK    ' + nama + (info ? '  ' + info : '')); }
  else { gagal++; console.log('  GAGAL ' + nama + (info ? '  ' + info : '')); }
};
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));

// â”€â”€ PROXY TIRUAN (meniru cacat: tidak pernah kirim frame items) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const stok = new Map([['AAA', 10], ['BBB', 5], ['CCC', 0]]);
const KUNCI = 'kunci-uji';

const proxy = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/ipos/api/items') {
    const data = [...stok.entries()].map(([kode, s]) => ({
      kode, nama: 'Barang ' + kode, satuan: 'PCS', harga: 1000, harga2: 900,
      hpp: 500, statusjual: 'Y', stok: s,
    }));
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, data }));
  }
  if (u.pathname === '/ipos/api/jual') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ siap: true, update: Math.floor(Date.now() / 1000), total: 0 }));
  }
  if (u.pathname === '/ipos/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.write('retry: 3000\n\n');
    // SENGAJA: hanya hello. TIDAK PERNAH `items` â€” inilah cacat proxy asli.
    res.write('event: hello\ndata: {"seri":1,"items":3}\n\n');
    const ka = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 3000);
    req.on('close', () => clearInterval(ka));
    return;
  }
  res.writeHead(404); res.end('{}');
});

// â”€â”€ PENERIMA TIRUAN (mencatat kiriman) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const diterima = [];
const penerima = http.createServer((req, res) => {
  let b = '';
  req.on('data', (d) => { b += d; });
  req.on('end', () => {
    let j = null;
    try { j = JSON.parse(b); } catch (_) {}
    if (j) diterima.push(j);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, perluPenuh: false }));
  });
});

(async () => {
  console.log('=== uji end-to-end: deteksi stok tanpa frame SSE ===');

  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  await new Promise((r) => penerima.listen(0, '127.0.0.1', r));
  const portProxy = proxy.address().port;
  const portTerima = penerima.address().port;

  const anak = spawn(process.execPath, [path.join(__dirname, 'push-agen.js')], {
    env: {
      ...process.env,
      PUSH_URL: 'http://127.0.0.1:' + portTerima,
      PUSH_TOKEN: 'token-uji',
      PUSH_TOKO: 'kefa',
      IPOS_KEFA_URL: 'http://127.0.0.1:' + portProxy + '/ipos',
      IPOS_KEFA_KEY: KUNCI,
      PUSH_JEDA_PENUH_MS: '3600000',   // jangan sampai katalog penuh menutupi delta
      PUSH_JEDA_LAPORAN_MS: '3600000',
      PUSH_PANTAU_MS: '500',
      PUSH_JEDA_STOK_MS: '800',
      // Kunci agen memakai berkas di boot\.push-agen.lock. Agen ASLI di PC
      // sedang memegangnya, jadi agen uji akan langsung keluar (kode 2) â€”
      // dan itu memang perilaku yang benar. Uji ini memakai kunci sendiri
      // supaya tidak mengganggu agen produksi.
      PUSH_LOCK_FILE: path.join(require('os').tmpdir(), 'push-agen-uji-' + process.pid + '.lock'),
    },
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  anak.stdout.on('data', (d) => log.push(String(d)));
  anak.stderr.on('data', (d) => log.push(String(d)));

  try {
    // 1. Tunggu katalog penuh awal.
    let penuh = null;
    for (let i = 0; i < 40; i++) {
      await tidur(500);
      penuh = diterima.find((x) => x.jenis === 'items');
      if (penuh) break;
    }
    uji('katalog penuh awal terkirim', !!penuh, penuh ? penuh.data.length + ' item' : 'tidak ada');
    assert.ok(penuh, 'agen tidak mengirim katalog awal');
    assert.strictEqual(penuh.data.length, 3);

    // 2. Buktikan proxy TIDAK mengirim frame items (cacat ditiru).
    // Cocokkan frasa yang HANYA dicetak saat frame items tiba. Jangan mencari
    // kata 'delta' saja: kata itu juga muncul di baris startup 'delta via SSE',
    // sehingga uji akan lulus palsu — dan uji yang lulus palsu lebih berbahaya
    // daripada tidak ada uji.
    const semuaLog = log.join('');
    const adaFrameItems = semuaLog.includes('dari SSE');
    uji('proxy tiruan memang TIDAK mengirim frame items', !adaFrameItems,
      adaFrameItems ? 'ada frame (tiruan tidak sahih)' : 'diam, seperti aslinya');

    // 3. Ubah STOK tanpa menyentuh harga/nama -> proxy asli akan diam.
    stok.set('AAA', 7);   // penjualan 3 pcs
    stok.set('BBB', 0);   // habis

    // 4. Tunggu agen mendeteksi sendiri.
    let delta = null;
    for (let i = 0; i < 60; i++) {
      await tidur(500);
      delta = diterima.find((x) => x.jenis === 'items-ubah');
      if (delta) break;
    }
    uji('agen mendeteksi perubahan stok SENDIRI (tanpa frame SSE)', !!delta,
      delta ? delta.data.length + ' item' : 'TIDAK TERDETEKSI');

    if (delta) {
      const kode = delta.data.map((x) => x.kode).sort();
      uji('delta berisi tepat item yang berubah', kode.join(',') === 'AAA,BBB', kode.join(','));
      const aaa = delta.data.find((x) => x.kode === 'AAA');
      uji('nilai stok baru ikut terkirim', aaa && Number(aaa.stok) === 7,
        aaa ? 'stok=' + aaa.stok : 'tidak ada');
      uji('item yang tidak berubah TIDAK ikut (hemat)', !delta.data.some((x) => x.kode === 'CCC'));
    }

    // 5. Tidak berubah lagi -> tidak boleh mengirim delta berulang.
    const jumlahSebelum = diterima.filter((x) => x.jenis === 'items-ubah').length;
    await tidur(4000);
    const jumlahSesudah = diterima.filter((x) => x.jenis === 'items-ubah').length;
    uji('stok tetap -> TIDAK mengirim delta berulang', jumlahSesudah === jumlahSebelum,
      'sebelum=' + jumlahSebelum + ' sesudah=' + jumlahSesudah);
  } finally {
    anak.kill('SIGKILL');
    proxy.close();
    penerima.close();
  }

  console.log('\n  lulus ' + lulus + '/' + (lulus + gagal));
  if (gagal) {
    console.log('  ADA YANG GAGAL');
    console.log('  --- log agen (20 baris terakhir) ---');
    log.join('').split(/\r?\n/).slice(-20).forEach((l) => console.log('    ' + l));
    process.exit(1);
  }
  console.log('  SEMUA LULUS');
  setTimeout(() => process.exit(0), 200);
})().catch((e) => {
  console.error('FATAL: ' + ((e && e.stack) || e));
  try { proxy.close(); penerima.close(); } catch (_) {}
  process.exit(1);
});

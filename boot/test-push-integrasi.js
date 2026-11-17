'use strict';
/**
 * UJI INTEGRASI DORONG -> TERIMA -> PAKAI.
 *
 * Ini uji yang paling penting untuk arsitektur baru, karena menguji TIGA hal
 * yang kalau salah satunya putus, seluruh aliran diam-diam tidak bekerja:
 *   1. HTTP menerima kiriman (express + token + validasi)
 *   2. Gudang menyimpan dan menaikkan versi
 *   3. Bridge MEMAKAI data itu (bukan tetap menarik dari iPos)
 *
 * Server HTTP-nya nyata (express sungguhan, port sementara), dan bridge-nya
 * nyata. Hanya alamat iPos yang dibuat mati sengaja: kalau bridge masih
 * mencoba menarik, uji ini GAGAL — itu justru yang ingin dibuktikan.
 */
const assert = require('assert');
const http = require('http');
const express = require('express');

// PUSH_TOKEN harus diset SEBELUM modul gudang dimuat (dibaca saat require).
process.env.PUSH_TOKEN = 'token-uji-integrasi';
process.env.PUSH_BATAS_SEKAR_DETIK = '180';

const gudang = require('./push-gudang');

let lulus = 0, gagal = 0;
const uji = (nama, fn) => {
  try { fn(); lulus++; console.log('  OK    ' + nama); }
  catch (e) { gagal++; console.log('  GAGAL ' + nama + ' -> ' + e.message); }
};
const ujiAsync = async (nama, fn) => {
  try { await fn(); lulus++; console.log('  OK    ' + nama); }
  catch (e) { gagal++; console.log('  GAGAL ' + nama + ' -> ' + e.message); }
};

const kirim = (port, isi, token) => new Promise((resolve, reject) => {
  const badan = Buffer.from(JSON.stringify(isi));
  const req = http.request({
    hostname: '127.0.0.1', port, path: '/api/ipos/push', method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': badan.length,
      ...(token ? { 'x-push-token': token } : {}),
    },
  }, (res) => {
    const p = [];
    res.on('data', (d) => p.push(d));
    res.on('end', () => {
      let j = null;
      try { j = JSON.parse(Buffer.concat(p).toString('utf8')); } catch (_) { /* bukan json */ }
      resolve({ status: res.statusCode, body: j });
    });
  });
  req.on('error', reject);
  req.write(badan);
  req.end();
});

(async () => {
  console.log('=== uji integrasi dorong -> terima -> pakai ===');

  // Server nyata yang memakai modul gudang, persis seperti index.js.
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.post('/api/ipos/push', (req, res) => {
    const hasil = gudang.terima(req.body, req.get('x-push-token'));
    res.status(hasil.status).json(hasil.body);
  });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  // ── 1. HTTP: token wajib ─────────────────────────────────────────────
  await ujiAsync('tanpa token ditolak 401', async () => {
    const r = await kirim(port, { toko: 'kefa', jenis: 'items', data: [{ kode: 'A' }] }, null);
    assert.strictEqual(r.status, 401);
  });

  await ujiAsync('token benar diterima 200', async () => {
    const r = await kirim(port, {
      toko: 'kefa', jenis: 'items',
      data: [{ kode: 'A', nama: 'Kursi', stok: 5 }, { kode: 'B', nama: 'Meja', stok: 2 }],
    }, 'token-uji-integrasi');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.ok, true);
    assert.strictEqual(r.body.jumlah, 2);
  });

  // ── 2. Gudang: tersimpan & versi naik ────────────────────────────────
  uji('gudang menyimpan katalog', () => {
    const items = gudang.ambilSegar('kefa', 'items', 1200);
    assert.ok(Array.isArray(items), 'items harus array');
    assert.strictEqual(items.length, 2);
  });

  uji('versi naik setiap kiriman (pemicu pemrosesan)', () => {
    const v1 = gudang.versiSekarang('kefa');
    assert.ok(v1 >= 1, 'versi harus >= 1 setelah kiriman');
  });

  // ── 3. Delta lewat HTTP nyata ────────────────────────────────────────
  await ujiAsync('delta lewat HTTP menggabungkan, bukan menimpa', async () => {
    const r = await kirim(port, {
      toko: 'kefa', jenis: 'items-ubah',
      data: [{ kode: 'B', nama: 'Meja', stok: 99 }],
    }, 'token-uji-integrasi');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.total, 2, 'total harus tetap 2');
    const items = gudang.ambilSegar('kefa', 'items', 1200);
    const b = items.find((x) => x.kode === 'B');
    assert.strictEqual(b.stok, 99);
  });

  // ── 4. Bridge MEMAKAI dorongan (bukan menarik) ───────────────────────
  // IPOS_URL sengaja diarahkan ke port tertutup. Kalau bridge masih mencoba
  // menarik, hasilnya error jaringan — dan uji ini gagal.
  process.env.IPOS_KEFA_URL = 'http://127.0.0.1:1/ipos';
  process.env.IPOS_KEFA_KEY = 'kunci-palsu';
  process.env.IPOS_KEFA_TOKO = 'kefa';

  const bridgePath = require.resolve('../ipos-bridge');
  delete require.cache[bridgePath];
  const bridge = require('../ipos-bridge');
  const kefa = bridge.kefa;

  await ujiAsync('bridge mengambil katalog dari DORONGAN, bukan dari iPos', async () => {
    assert.ok(kefa, 'instans kefa harus ada');
    // syncStok memanggil ambilItems() -> harus sukses tanpa menyentuh jaringan.
    const dataBarang = [];
    const hasil = await kefa.syncStok(dataBarang, { verbose: false });
    assert.strictEqual(hasil.ok, true, 'sync harus berhasil tanpa jaringan: ' + (hasil.err || ''));
    assert.strictEqual(hasil.total, 2);
  });

  await ujiAsync('status bridge melaporkan realtime (dorong)', async () => {
    const s = kefa.status();
    assert.strictEqual(s.online, true);
    assert.ok(String(s.sse).includes('realtime'), 'sse harus realtime, dapat: ' + s.sse);
    assert.strictEqual(s.total, 2);
  });

  // ── 5. Laporan penjualan dari dorongan ───────────────────────────────
  await ujiAsync('laporan penjualan dipakai dari dorongan', async () => {
    // `dari`/`sampai` WAJIB ada: bentuk asli respons proxy selalu menyertakannya,
    // dan bridge memakainya untuk memastikan laporan yang disajikan memang
    // untuk tanggal yang diminta (bukan angka tanggal lain).
    const r = await kirim(port, {
      toko: 'kefa', jenis: 'jual',
      data: {
        siap: true, dari: '2026-11-15', sampai: '2026-11-15',
        update: Math.floor(Date.now() / 1000),
        kasir: [{ nama: 'A', omzet: 1000 }], total: 1000,
      },
    }, 'token-uji-integrasi');
    assert.strictEqual(r.status, 200);
    const lap = await kefa.ambilLaporanKasir('2026-11-15');
    assert.ok(lap && lap.siap === true, 'laporan harus dari dorongan');
    assert.strictEqual(lap.total, 1000);
  });

  // ── 6. Data basi TIDAK boleh diam-diam dipakai ───────────────────────
  await ujiAsync('katalog basi -> bridge melaporkan gagal, bukan memakai angka beku', async () => {
    // Mundurkan umur data 1 jam, batas pakai 20 menit -> harus dianggap basi.
    gudang._mundurkanWaktu('kefa', 'items', 3600000);
    process.env.PUSH_BATAS_PAKAI_DETIK = '1200';
    const p2 = require.resolve('../ipos-bridge');
    delete require.cache[p2];
    const b2 = require('../ipos-bridge');
    const hasil = await b2.kefa.syncStok([], { verbose: false });
    assert.strictEqual(hasil.ok, false, 'harus gagal karena data basi');
    assert.ok(/basi|belum ada/i.test(String(hasil.err)), 'pesan harus menyebut basi, dapat: ' + hasil.err);
    delete process.env.PUSH_BATAS_PAKAI_DETIK;
  });

  server.close();
  console.log('\n  lulus ' + lulus + '/' + (lulus + gagal));
  if (gagal) { console.log('  ADA YANG GAGAL'); process.exit(1); }
  console.log('  SEMUA LULUS');
  setTimeout(() => process.exit(0), 100);
})();

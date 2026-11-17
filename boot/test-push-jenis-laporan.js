'use strict';
/**
 * UJI JENIS LAPORAN DORONGAN.
 *
 * BUG YANG DIUJI
 * --------------
 * Cabang dorong di ipos-bridge.js dulu SELALU membaca jenis `jual`, apa pun
 * endpoint yang diminta. Akibatnya laporan MEREK dan MARKETPLACE menerima
 * bentuk laporan KASIR: `data`, `pelanggan`, `central` tidak ada, sehingga bot
 * menampilkan NOL tanpa satu pun error. Kesalahan yang tampak persis seperti
 * "toko sedang sepi" — dan karena itu paling berbahaya.
 *
 * Uji ini memberi EMPAT bentuk laporan yang berbeda dan menandai masing-masing
 * dengan kunci yang khas, lalu memastikan setiap pemanggil mendapat bentuk
 * MILIKNYA. Sebelum perbaikan, uji ini gagal pada merek & marketplace.
 *
 * Uji juga memastikan rentang tanggal yang tidak dicakup DITOLAK dengan pesan
 * jelas, bukan dijawab dengan angka yang salah.
 */
const assert = require('assert');
const http = require('http');
const express = require('express');

process.env.PUSH_TOKEN = 'token-uji-jenis-laporan';
process.env.IPOS_KEFA_URL = 'http://127.0.0.1:1/ipos'; // sengaja mati: tidak boleh ditarik
process.env.IPOS_KEFA_KEY = 'kunci-palsu';
process.env.IPOS_KEFA_TOKO = 'kefa';
process.env.PUSH_BATAS_LAPORAN_DETIK = '180';

const gudang = require('./push-gudang');

let lulus = 0, gagal = 0;
const ujiAsync = async (nama, fn) => {
  try { await fn(); lulus++; console.log('  OK    ' + nama); }
  catch (e) { gagal++; console.log('  GAGAL ' + nama + ' -> ' + e.message); }
};

const kirim = (port, isi) => new Promise((resolve, reject) => {
  const badan = Buffer.from(JSON.stringify(isi));
  const req = http.request({
    hostname: '127.0.0.1', port, path: '/api/ipos/push', method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': badan.length,
      'x-push-token': 'token-uji-jenis-laporan',
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

const HARI = '2026-11-15';
const LUSA = '2026-11-17';

(async () => {
  console.log('=== uji jenis laporan dorongan ===');

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.post('/api/ipos/push', (req, res) => {
    const hasil = gudang.terima(req.body, req.get('x-push-token'));
    res.status(hasil.status).json(hasil.body);
  });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  // Katalog dulu supaya penerima punya dasar (bukan wajib, tapi realistis).
  await kirim(port, { toko: 'kefa', jenis: 'items', data: [{ kode: 'A', nama: 'Kursi', stok: 1 }] });

  // ── Empat laporan dengan penanda KHAS masing-masing ──────────────────
  await kirim(port, {
    toko: 'kefa', jenis: 'jual',
    data: {
      siap: true, dari: HARI, sampai: HARI, update: Math.floor(Date.now() / 1000),
      total: { nota: 7, omzet: 7000, item: 70 }, kasir: [{ nama: 'KASIR-A', omzet: 7000 }],
      perTipe: { KSR: { nota: 7 } }, nonaktif: [],
      __penanda: 'JUAL-KASIR',
    },
  });
  await kirim(port, {
    toko: 'kefa', jenis: 'jual-merek',
    data: {
      siap: true, dari: HARI, sampai: HARI, update: Math.floor(Date.now() / 1000),
      merek: ['HOMMY', 'KIREI'], data: [{ merek: 'HOMMY', nota: 3, omzet: 3000 }],
      total: { nota: 3, omzet: 3000 }, pelanggan: [], totalPelanggan: 0, notaRentang: 7,
      __penanda: 'JUAL-MEREK',
    },
  });
  await kirim(port, {
    toko: 'kefa', jenis: 'jual-marketplace',
    data: {
      siap: true, dari: HARI, sampai: HARI, update: Math.floor(Date.now() / 1000),
      toko: [], central: { nota: 2, omzet: 2000, notas: [] }, total: 2000, nomor: 2,
      __penanda: 'JUAL-MARKETPLACE',
    },
  });

  const bridgePath = require.resolve('../ipos-bridge');
  delete require.cache[bridgePath];
  const bridge = require('../ipos-bridge');
  const kefa = bridge.kefa;
  assert.ok(kefa, 'instans kefa harus ada');

  // ── Setiap pemanggil harus mendapat BENTUK MILIKNYA ──────────────────
  await ujiAsync('kasir -> laporan kasir (bukan merek/marketplace)', async () => {
    const r = await kefa.ambilLaporanKasir(HARI, HARI);
    assert.strictEqual(r.__penanda, 'JUAL-KASIR', 'dapat: ' + JSON.stringify(r).slice(0, 120));
    assert.ok(Array.isArray(r.kasir), 'harus punya kasir[]');
  });

  await ujiAsync('merek -> laporan MEREK (ini yang dulu salah)', async () => {
    const r = await kefa.ambilLaporanMerek(HARI, HARI);
    assert.strictEqual(r.__penanda, 'JUAL-MEREK',
      'DULU mengembalikan laporan kasir. Sekarang harus merek. dapat: ' + r.__penanda);
    assert.ok(Array.isArray(r.data), 'harus punya data[] per merek');
    assert.deepStrictEqual(r.merek, ['HOMMY', 'KIREI']);
  });

  await ujiAsync('marketplace -> laporan MARKETPLACE (ini yang dulu salah)', async () => {
    const r = await kefa.ambilLaporanMarketplace(HARI, HARI);
    assert.strictEqual(r.__penanda, 'JUAL-MARKETPLACE',
      'DULU mengembalikan laporan kasir. Sekarang harus marketplace. dapat: ' + r.__penanda);
    assert.ok(r.central && typeof r.central === 'object', 'harus punya central');
    assert.strictEqual(r.nomor, 2);
  });

  // ── Rentang yang tidak dicakup: JANGAN dijawab dengan angka salah ────
  //
  // Perilaku yang benar BUKAN sekadar menolak. Dulu bridge menolak dengan
  // "hanya tersedia untuk <hari ini>", dan akibatnya laporan tanggal lampau
  // yang datanya ADA di sumber (mis. marketplace CP 14/11/2026 = 6 nota /
  // Rp 26.583.000) dilaporkan kosong kepada pengguna. Sekarang bridge mencatat
  // PESANAN untuk dijemput PC dan memberi galat bertanda, sehingga:
  //   - pemanggil tahu datanya sedang diambil (bukan "tidak ada penjualan"),
  //   - dan angka hari ini tidak pernah dipakai untuk menjawab tanggal lain.
  await ujiAsync('rentang lain TIDAK dijawab dengan angka hari ini', async () => {
    let galat = null;
    try { await kefa.ambilLaporanMerek('2026-11-01', '2026-11-02'); }
    catch (e) { galat = e; }
    assert.ok(galat, 'harus melempar error, bukan mengembalikan data hari ini');
    assert.ok(!/2026-11-15/.test(galat.message) || galat.kode === 'MENUNGGU_DORONG',
      'tidak boleh menyajikan angka rentang lain, dapat: ' + galat.message);
    assert.strictEqual(galat.kode, 'MENUNGGU_DORONG',
      'galat harus bertanda MENUNGGU_DORONG agar pemanggil bisa menunggu, dapat: ' + galat.kode);
    assert.strictEqual(galat.jenis, 'jual-merek', 'galat harus menyebut jenisnya');
    assert.strictEqual(galat.dari, '2026-11-01', 'galat harus membawa tanggal yang diminta');
    assert.strictEqual(galat.sampai, '2026-11-02', 'galat harus membawa tanggal akhir');
  });

  // ── Setelah PC mengirim rentang itu, permintaan yang sama tersedia ───
  await ujiAsync('rentang lampau tersedia setelah PC mengirimnya', async () => {
    const gudang = require('./push-gudang');
    gudang.terima({
      toko: 'kefa', jenis: 'jual-merek',
      data: {
        siap: true, dari: '2026-11-01', sampai: '2026-11-02',
        merek: ['HOMMY', 'KIREI'], data: [], total: { nota: 0, item: 0, omzet: 0 },
        jangkauan: { dari: '2026-01-06', sampai: '2026-11-15' }, update: 1794800000000,
      },
    }, process.env.PUSH_TOKEN);
    const r = await kefa.ambilLaporanMerek('2026-11-01', '2026-11-02');
    assert.strictEqual(r.dari, '2026-11-01');
    assert.strictEqual(r.sampai, '2026-11-02');
    assert.ok(Array.isArray(r.merek), 'harus berbentuk laporan merek, bukan laporan kasir');
  });

  await ujiAsync('rentang yang cocok tetap dilayani', async () => {
    const r = await kefa.ambilLaporanMerek(HARI, HARI);
    assert.strictEqual(r.__penanda, 'JUAL-MEREK');
  });

  // ── Jenis yang belum pernah didorong: gagal terlihat, bukan nol ──────
  await ujiAsync('jenis belum pernah didorong -> error yang menyebut jenisnya', async () => {
    const nk = bridge.buatBridge({
      url: 'http://127.0.0.1:1/ipos', key: 'kunci-palsu', toko: ['nk'], label: 'NK',
    });
    let pesan = null;
    try { await nk.ambilLaporanMarketplace(HARI, HARI); }
    catch (e) { pesan = e.message; }
    assert.ok(pesan && /jual-marketplace/.test(pesan),
      'pesan harus menyebut jual-marketplace, dapat: ' + pesan);
  });

  server.close();
  console.log('\n  lulus ' + lulus + '/' + (lulus + gagal));
  if (gagal) { console.log('  ADA YANG GAGAL'); process.exit(1); }
  console.log('  SEMUA LULUS');
  setTimeout(() => process.exit(0), 100);
})().catch((e) => {
  console.log('FATAL: ' + ((e && e.stack) || e));
  process.exit(1);
});

'use strict';
/**
 * UJI: LAPORAN TANGGAL LAMPAU TIDAK BOLEH KOSONG.
 *
 * BUG YANG DIUJI
 * --------------
 * Pengguna meminta laporan marketplace CP 14/11/2026. Di sumbernya ada
 * 6 nota / Rp 26.583.000. Bot melaporkan KOSONG.
 *
 * Sebabnya: agen hanya mendorong laporan HARI INI, dan bridge MENOLAK rentang
 * tanggal lain. Penolakan itu benar niatnya (jangan menyajikan angka hari ini
 * untuk pertanyaan tanggal lain) tetapi salah akibatnya: pengguna kehilangan
 * data yang sebenarnya ADA.
 *
 * YANG DIBUKTIKAN DI SINI
 * -----------------------
 *  1. Rentang tanggal lampau yang sudah ada di gudang -> DISAJIKAN, bukan ditolak.
 *  2. Rentang yang belum ada -> PESANAN dicatat untuk dijemput PC, dan galatnya
 *     ditandai `MENUNGGU_DORONG` supaya pemanggil bisa menunggu lalu mengulang.
 *  3. Setelah PC mengirim hasilnya, permintaan yang sama LANGSUNG tersedia.
 *  4. Laporan HARI INI tetap wajib segar: laporan beku tidak boleh disajikan.
 *  5. Laporan tanggal lampau yang tidak segar TETAP boleh dipakai (tanggal
 *     lampau tidak berubah lagi) — inilah yang membedakannya dari nomor 4.
 *  6. Jenis laporan tidak tercampur: marketplace tidak pernah dilayani data jual.
 *
 * Uji ini GAGAL pada kode lama: kode lama melempar galat "hanya tersedia untuk
 * <hari ini>, bukan <tanggal lampau>" untuk kasus nomor 1.
 */
const path = require('path');
const os = require('os');

// Token harus ada SEBELUM modul gudang dimuat (ia membaca env saat require).
process.env.PUSH_TOKEN = process.env.PUSH_TOKEN || 'token-uji-rentang';
process.env.PUSH_STATUS_FILE = path.join(os.tmpdir(), 'uji-rentang-status.json');
// Bridge menolak bekerja tanpa kunci toko, bahkan dalam mode dorong (ia
// memeriksa kunci lebih dulu). Nilai tiruan sudah cukup: mode dorong tidak
// pernah memakai kunci ini untuk menghubungi jaringan.
if (!process.env.IPOS_KEY) process.env.IPOS_KEY = 'kunci-uji';
if (!process.env.IPOS_URL) process.env.IPOS_URL = 'http://127.0.0.1:9/ipos';

const { buatPenerima } = require('./push-penerima');
const gudang = require('./push-gudang');

let lulus = 0;
let gagal = 0;
const pesanGagal = [];

function cek(nama, syarat, detail) {
  if (syarat) {
    lulus++;
    console.log('  OK   ' + nama);
  } else {
    gagal++;
    pesanGagal.push(nama + (detail ? ' -> ' + detail : ''));
    console.log('  GAGAL ' + nama + (detail ? ' -> ' + detail : ''));
  }
}

// ── Data tiruan yang bentuknya SAMA dengan respons proxy sebenarnya ────────
// Diambil dari respons mentah CP 14/11/2026: 6 nota, omzet 26.583.000.
const MP_LAMPAU = {
  siap: true, dari: '2026-11-14', sampai: '2026-11-14',
  toko: [], total: 26583000, nomor: 12,
  central: {
    nota: 6, omzet: 26583000, tunai: 0, debit: 26583000,
    notas: [
      { notransaksi: '000361/CP./11/26', tipe: 'JL', tanggal: '2026-11-14', omzet: 15700000 },
      { notransaksi: '005662/CP/11/26', tipe: 'KSR', tanggal: '2026-11-14', omzet: 1632000 },
      { notransaksi: '005665/CP/11/26', tipe: 'KSR', tanggal: '2026-11-14', omzet: 7997000 },
      { notransaksi: '005979/CP/11/26', tipe: 'KSR', tanggal: '2026-11-14', omzet: 265000 },
      { notransaksi: '006071/CP/11/26', tipe: 'KSR', tanggal: '2026-11-14', omzet: 810000 },
      { notransaksi: '006072/CP/11/26', tipe: 'KSR', tanggal: '2026-11-14', omzet: 260000 },
    ],
  },
  jangkauan: { dari: '2026-01-06', sampai: '2026-11-17' },
  update: 1794700000000,
};

const MP_HARI_INI = {
  siap: true, dari: '2026-11-17', sampai: '2026-11-17',
  toko: [], total: 0, nomor: 12,
  central: { nota: 0, omzet: 0, tunai: 0, debit: 0, notas: [] },
  jangkauan: { dari: '2026-01-06', sampai: '2026-11-17' },
  update: 1794880000000,
};

// Bentuk laporan KASIR — dipakai membuktikan jenis tidak tercampur.
const JUAL_HARI_INI = {
  siap: true, dari: '2026-11-17', sampai: '2026-11-17',
  kasir: [{ userid: 'kasir1', nota: 18, item: 40, omzet: 24813000 }],
  total: { nota: 18, item: 40, omzet: 24813000, tunai: 0, debit: 0, kredit: 0, kasir: 1 },
  jangkauan: { dari: '2026-01-06', sampai: '2026-11-17' },
  update: 1794880000000,
};

const TOKEN = process.env.PUSH_TOKEN;

// ── Bagian 1: logika penerima/gudang ──────────────────────────────────────
console.log('=== 1. penerima: gudang rentang & pesanan ===');
{
  const p = buatPenerima({ token: TOKEN, batasSegarLaporanDetik: 180 });

  // Belum ada apa-apa.
  cek('rentang kosong -> null', p.ambilRentang('cp', 'jual-marketplace', '2026-11-14', '2026-11-14') === null);
  // Simpan laporan hari ini lewat jalur normal.
  const h1 = p.terima({ toko: 'cp', jenis: 'jual-marketplace', data: MP_HARI_INI }, TOKEN);
  cek('terima laporan hari ini -> 200', h1.status === 200, 'status=' + h1.status);
  cek('respons menyebut rentangnya', !!h1.body.rentang
    && h1.body.rentang.dari === '2026-11-17' && h1.body.rentang.sampai === '2026-11-17',
    JSON.stringify(h1.body.rentang));

  // Simpan laporan tanggal lampau.
  const h2 = p.terima({ toko: 'cp', jenis: 'jual-marketplace', data: MP_LAMPAU }, TOKEN);
  cek('terima laporan lampau -> 200', h2.status === 200, 'status=' + h2.status);
  cek('laporan lampau tersimpan per rentang',
    !!p.ambilRentang('cp', 'jual-marketplace', '2026-11-14', '2026-11-14'));

  // PENTING: laporan lampau TIDAK menimpa slot laporan hari ini.
  const slot = p.ambil('cp', 'jual-marketplace');
  cek('laporan lampau tidak menimpa laporan hari ini',
    slot && slot.dari === '2026-11-17', slot && slot.dari);
  cek('slot hari ini masih berisi angka hari ini',
    slot && slot.central && slot.central.nota === 0, slot && slot.central && slot.central.nota);

  // Pesanan: dicatat, bisa dijemput, tidak berlipat.
  p.mintaRentang('cp', 'jual-merek', '2026-11-01', '2026-11-05');
  p.mintaRentang('cp', 'jual-merek', '2026-11-01', '2026-11-05');
  const jemput1 = p.jemputPermintaan('cp');
  cek('dua permintaan sama -> satu pesanan', jemput1.length === 1, 'jumlah=' + jemput1.length);
  cek('pesanan membawa jenis & rentang',
    jemput1[0] && jemput1[0].jenis === 'jual-merek'
    && jemput1[0].dari === '2026-11-01' && jemput1[0].sampai === '2026-11-05',
    JSON.stringify(jemput1[0]));

  // Setelah hasil dikirim, pesanan hilang.
  p.terima({
    toko: 'cp', jenis: 'jual-merek',
    data: { siap: true, dari: '2026-11-01', sampai: '2026-11-05', merek: ['HOMMY', 'KIREI'], data: [], total: { nota: 0, item: 0, omzet: 0 }, update: 1794800000000 },
  }, TOKEN);
  cek('pesanan hilang setelah hasilnya diterima', p.jemputPermintaan('cp').length === 0);

  // Token salah harus ditolak (jangan sampai endpoint jadi terbuka).
  cek('token salah ditolak', p.terima({ toko: 'cp', jenis: 'jual', data: JUAL_HARI_INI }, 'salah').status === 401);
  // Data kosong ditolak (jangan sampai menghapus data bagus).
  cek('data kosong ditolak', p.terima({ toko: 'cp', jenis: 'jual', data: null }, TOKEN).status === 400);
  // Jenis tak dikenal ditolak.
  cek('jenis tak dikenal ditolak', p.terima({ toko: 'cp', jenis: 'entah', data: {} }, TOKEN).status === 400);
}

// ── Bagian 2: bridge menyajikan laporan tanggal lampau ────────────────────
console.log('');
console.log('=== 2. bridge: laporan tanggal lampau disajikan, bukan ditolak ===');
(async () => {
  // Isi gudang yang dipakai bridge (instans tunggal dari require cache).
  gudang.terima({ toko: 'cp', jenis: 'jual', data: JUAL_HARI_INI }, TOKEN);
  gudang.terima({ toko: 'cp', jenis: 'jual-marketplace', data: MP_HARI_INI }, TOKEN);
  gudang.terima({ toko: 'cp', jenis: 'jual-marketplace', data: MP_LAMPAU }, TOKEN);

  const bridge = require('../ipos-bridge');

  // 1. Tanggal lampau yang ADA -> harus disajikan dengan angka yang benar.
  let r = null;
  try {
    r = await bridge.cp.ambilLaporanMarketplace('2026-11-14', '2026-11-14');
  } catch (e) {
    r = { __err: e.message };
  }
  cek('marketplace 14/11 TIDAK error', !r.__err, r.__err);
  cek('marketplace 14/11 berisi 6 nota',
    r && r.central && r.central.nota === 6, r && r.central && r.central.nota);
  cek('marketplace 14/11 omzet 26.583.000',
    r && r.central && r.central.omzet === 26583000, r && r.central && r.central.omzet);
  cek('marketplace 14/11 membawa rentang yang diminta',
    r && r.dari === '2026-11-14' && r.sampai === '2026-11-14', r && (r.dari + '..' + r.sampai));
  cek('marketplace 14/11 membawa 6 baris nota',
    r && r.central && Array.isArray(r.central.notas) && r.central.notas.length === 6,
    r && r.central && r.central.notas && r.central.notas.length);

  // 2. Tanggal lampau yang BELUM ada -> galat bertanda, dan pesanan tercatat.
  let galat = null;
  try {
    await bridge.cp.ambilLaporanMarketplace('2026-10-03', '2026-10-03');
  } catch (e) {
    galat = e;
  }
  cek('tanggal lampau yang belum ada -> galat bertanda MENUNGGU_DORONG',
    galat && galat.kode === 'MENUNGGU_DORONG', galat && galat.kode);
  cek('galat membawa jenis & rentang yang diminta',
    galat && galat.jenis === 'jual-marketplace' && galat.dari === '2026-10-03',
    galat && (galat.jenis + ' ' + galat.dari));
  const pesanan = gudang.jemputPermintaan('cp');
  cek('pesanan tercatat untuk dijemput PC',
    pesanan.some((x) => x.jenis === 'jual-marketplace' && x.dari === '2026-10-03'),
    JSON.stringify(pesanan));

  // 3. Setelah PC mengirim, tanggal itu langsung tersedia.
  gudang.terima({
    toko: 'cp', jenis: 'jual-marketplace',
    data: {
      siap: true, dari: '2026-10-03', sampai: '2026-10-03', toko: [], total: 1000000, nomor: 5,
      central: { nota: 2, omzet: 1000000, tunai: 1000000, debit: 0, notas: [{ tipe: 'KSR', tanggal: '2026-10-03', omzet: 1000000 }] },
      jangkauan: { dari: '2026-01-06', sampai: '2026-11-17' }, update: 1794000000000,
    },
  }, TOKEN);
  let r3 = null;
  try {
    r3 = await bridge.cp.ambilLaporanMarketplace('2026-10-03', '2026-10-03');
  } catch (e) {
    r3 = { __err: e.message };
  }
  cek('setelah PC mengirim, 03/10 langsung tersedia', !r3.__err && r3.central && r3.central.nota === 2,
    r3.__err || (r3.central && r3.central.nota));

  // 4. Laporan HARI INI tetap wajib segar.
  //    Mundurkan waktu terima laporan jual sampai lewat batas -> harus basi.
  gudang._mundurkanWaktu('cp', 'jual', 400 * 1000);
  let galatBasi = null;
  try {
    await bridge.cp.ambilLaporanKasir('2026-11-17', '2026-11-17', { fresh: true });
  } catch (e) {
    galatBasi = e;
  }
  cek('laporan hari ini yang beku TIDAK disajikan',
    galatBasi && /basi/i.test(galatBasi.message), galatBasi && galatBasi.message);

  // 5. Laporan tanggal lampau yang sudah tua TETAP boleh dipakai:
  //    tanggal lampau tidak berubah lagi. Ini yang membedakannya dari nomor 4.
  gudang._mundurkanWaktu('cp', 'jual-marketplace', 400 * 1000);
  let r5 = null;
  try {
    r5 = await bridge.cp.ambilLaporanMarketplace('2026-11-14', '2026-11-14');
  } catch (e) {
    r5 = { __err: e.message };
  }
  cek('laporan lampau yang tua tetap disajikan (tidak berubah lagi)',
    !r5.__err && r5.central && r5.central.nota === 6, r5.__err || (r5.central && r5.central.nota));

  // 6. Jenis tidak tercampur: marketplace tidak pernah dilayani data kasir.
  cek('marketplace tidak berisi bentuk laporan kasir',
    !(r5 && Array.isArray(r5.kasir)), r5 && typeof r5.kasir);

  console.log('');
  console.log('=== RINGKASAN ===');
  console.log('  lulus: ' + lulus + '   gagal: ' + gagal);
  if (gagal) {
    console.log('  GAGAL:');
    for (const p of pesanGagal) console.log('   - ' + p);
    process.exit(1);
  }
  console.log('  SEMUA LULUS');
  process.exit(0);
})().catch((e) => {
  console.log('FATAL: ' + ((e && e.stack) || e));
  process.exit(1);
});

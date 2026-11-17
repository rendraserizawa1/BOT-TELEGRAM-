'use strict';
/**
 * UJI: LAPORAN BEKU HARUS DIPERINGATKAN, BUKAN DITAMPILKAN SEPERTI BARU.
 *
 * KELUHAN YANG DIUJI
 * ------------------
 * "LAPORAN PENJUALAN KASIR TIDAK UPDATE MASIH BASI / BEKU."
 *
 * Kasus nyata: proxy CP tidak bisa mencapai DB-nya
 * (`connect ENETUNREACH 192.168.77.250:5444`), sehingga `update` laporan
 * berhenti bertambah selama ~80 menit. Agen tetap MENGIRIM ULANG laporan yang
 * sama tiap menit, jadi dari sisi /health kirimannya tampak segar — padahal
 * ANGKA di dalamnya sudah 80 menit tidak berubah. Bot menampilkan angka itu
 * tanpa satu pun tanda, sehingga penjualan setelah titik beku seolah tidak
 * pernah terjadi.
 *
 * YANG DIBUKTIKAN
 * ---------------
 *  1. Laporan dengan `update` tua menghasilkan header peringatan.
 *  2. Laporan yang masih segar TIDAK menghasilkan peringatan (jangan alarm palsu).
 *  3. Batasnya jelas: di bawah 10 menit tidak diperingatkan, di atasnya ya.
 *  4. Sebab kebekuan ikut ditampilkan bila tersedia.
 *  5. `update` dalam satuan DETIK (bukan milidetik) juga ditangani — proxy
 *     berbeda build memakai satuan berbeda, dan salah satuan membuat umur
 *     menjadi 50 tahun sehingga alarm palsu.
 */
const assert = require('assert');

let lulus = 0;
let gagal = 0;
function uji(nama, fn) {
  try { fn(); lulus++; console.log('  OK   ' + nama); }
  catch (e) { gagal++; console.log('  GAGAL ' + nama + ' -> ' + e.message); }
}

// Ambil fungsi asli dari index.js tanpa menjalankan seluruh bot.
// index.js tidak bisa di-require (ia langsung menjalankan bot), jadi fungsi
// yang diuji diambil dengan mengekstrak sumbernya. Cara ini rapuh terhadap
// perubahan nama, dan itu memang diinginkan: kalau fungsinya hilang/berubah
// nama, uji ini harus berteriak, bukan diam-diam lulus.
const fs = require('fs');
const path = require('path');
const SUMBER = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

function ekstrak(nama) {
  const mulai = SUMBER.indexOf('function ' + nama + '(');
  assert.ok(mulai >= 0, 'fungsi ' + nama + ' tidak ditemukan di index.js');
  // Cari penutup fungsi dengan menghitung kurawal.
  let i = SUMBER.indexOf('{', mulai);
  let dalam = 0;
  for (; i < SUMBER.length; i++) {
    if (SUMBER[i] === '{') dalam++;
    else if (SUMBER[i] === '}') { dalam--; if (dalam === 0) { i++; break; } }
  }
  return SUMBER.slice(mulai, i);
}

// `escapeMd` dan `GARIS_TEBAL` dipakai fungsi itu; sediakan tiruannya.
const escapeMd = (s) => String(s == null ? '' : s).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
const GARIS_TEBAL = '━━━━━━━━━━━━━━━━━━━━';
const ymdLokal = (geser) => {
  const d = new Date();
  d.setDate(d.getDate() + (geser || 0));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

const sumberHeader = ekstrak('headerLaporanBasi');
const sumberUmur = ekstrak('umurLaporanDetik');
const sumberPeringatan = ekstrak('peringatanBasiLaporan');
// eslint-disable-next-line no-new-func
const { headerLaporanBasi, peringatanBasiLaporan, umurLaporanDetik } = new Function(
  'escapeMd', 'GARIS_TEBAL', 'ymdLokal',
  sumberHeader + '\n' + sumberUmur + '\n' + sumberPeringatan
    + '\nreturn { headerLaporanBasi, peringatanBasiLaporan, umurLaporanDetik };',
)(escapeMd, GARIS_TEBAL, ymdLokal);

const umurMs = (menit) => Date.now() - menit * 60 * 1000;

console.log('=== uji peringatan laporan beku ===');

uji('laporan beku 80 menit -> ADA peringatan', () => {
  const h = headerLaporanBasi(80 * 60, null);
  assert.ok(h && h.length > 0, 'harus ada header, dapat kosong');
  assert.ok(/BEKU/.test(h), 'harus menyebut BEKU, dapat: ' + h.slice(0, 60));
  assert.ok(/1 jam 20 menit/.test(h), 'harus menyebut lamanya, dapat: ' + h.slice(0, 120));
  assert.ok(/TIDAK termasuk/.test(h), 'harus menyebut ada penjualan yang tidak termasuk');
});

uji('laporan segar (30 dtk) -> TIDAK ada peringatan', () => {
  const h = headerLaporanBasi(30, null);
  assert.strictEqual(h, '', 'tidak boleh ada alarm palsu, dapat: ' + h);
});

uji('laporan 9 menit -> belum diperingatkan (ambang 10 menit)', () => {
  assert.strictEqual(headerLaporanBasi(9 * 60, null), '');
});

uji('laporan 11 menit -> sudah diperingatkan', () => {
  const h = headerLaporanBasi(11 * 60, null);
  assert.ok(h && /11 menit/.test(h), 'harus menyebut 11 menit, dapat: ' + h);
});

uji('umur tidak diketahui (NaN) -> tidak memperingatkan (jangan mengarang)', () => {
  assert.strictEqual(headerLaporanBasi(NaN, null), '');
  assert.strictEqual(headerLaporanBasi(null, null), '');
  assert.strictEqual(headerLaporanBasi(undefined, null), '');
});

uji('sebab kebekuan ikut ditampilkan bila ada', () => {
  const h = headerLaporanBasi(80 * 60, 'connect ENETUNREACH 192.168.77.250:5444');
  assert.ok(/Sebab/.test(h), 'harus menyebut sebab');
  assert.ok(/ENETUNREACH/.test(h), 'harus memuat pesan sebabnya');
});

uji('sebab panjang dipotong, tidak membanjiri pesan', () => {
  const h = headerLaporanBasi(80 * 60, 'x'.repeat(500));
  assert.ok(h.length < 500, 'pesan harus dipotong, panjang=' + h.length);
});

// ── Bagian 2: pemakaian nyata di laporan kasir ───────────────────────────
console.log('');
console.log('=== uji: laporan kasir memakai peringatan itu ===');

uji('laporan kasir memakai peringatan itu', () => {
  // PENTING: teks "LAPORAN PENJUALAN KASIR" muncul di beberapa tempat (jalur
  // "tidak ada penjualan", judul laporan penuh, dan komentar menu). Mencari
  // posisi mentahnya rapuh dan pernah membuat uji ini gagal padahal kodenya
  // benar. Jadi yang diperiksa adalah HUBUNGAN strukturalnya: variabel
  // `basiKasir` harus diisi dari peringatanBasiLaporan dan dipakai di blok kasir.
  assert.ok(/const basiKasir = peringatanBasiLaporan\(/.test(SUMBER),
    'blok kasir harus menghitung basiKasir dari peringatanBasiLaporan');
  assert.ok(/if \(basiKasir\) lines\.push\(basiKasir\)/.test(SUMBER),
    'basiKasir harus benar-benar dimasukkan ke isi laporan');
  // Dan harus berada TEPAT SEBELUM judul laporan, supaya peringatan terbaca
  // lebih dulu daripada angkanya. Ini asersi yang bermakna: posisi salah
  // berarti pengguna melihat angka beku sebelum tahu bahwa itu beku.
  const iBasi = SUMBER.indexOf('const basiKasir = peringatanBasiLaporan(');
  const iJudul = SUMBER.indexOf("lines.push('🧾 *LAPORAN PENJUALAN KASIR*')");
  assert.ok(iJudul > iBasi && iJudul - iBasi < 1200,
    'basiKasir harus tepat sebelum judul laporan kasir');
});

uji('laporan merek memakai peringatan itu', () => {
  assert.ok(/const basiHk = peringatanBasiLaporan\(/.test(SUMBER),
    'blok merek harus menghitung basiHk dari peringatanBasiLaporan');
  assert.ok(/if \(basiHk\) lines\.push\(basiHk\)/.test(SUMBER),
    'basiHk harus dimasukkan ke isi laporan');
});

uji('laporan marketplace memakai peringatan itu', () => {
  assert.ok(/const basiMp = peringatanBasiLaporan\(/.test(SUMBER),
    'blok marketplace harus menghitung basiMp dari peringatanBasiLaporan');
  assert.ok(/if \(basiMp\) lines\.push\(basiMp\)/.test(SUMBER),
    'basiMp harus dimasukkan ke isi laporan');
});

uji('jalur "tidak ada penjualan" juga memakai peringatan itu', () => {
  assert.ok(/const basiKosong = peringatanBasiLaporan\(/.test(SUMBER),
    'jalur "tidak ada penjualan" harus memeriksa kebekuan lebih dulu — '
    + 'tanpa itu bot menjawab "tidak ada penjualan" padahal datanya tidak terbaca');
});

uji('umur dihitung dari `update`, bukan dari waktu KIRIMAN', () => {
  // Ini inti bug: kiriman segar, data beku. Kalau yang dipakai waktu kiriman,
  // laporan beku akan tampak segar selamanya.
  const iUmur = SUMBER.indexOf('function umurLaporanDetik(');
  assert.ok(iUmur > 0, 'fungsi umurLaporanDetik harus ada');
  const potong = SUMBER.slice(iUmur, iUmur + 400);
  assert.ok(/r\.update|u = Number\(r && r\.update\)/.test(potong),
    'umur harus dihitung dari r.update (waktu sumber), bukan dari waktu kiriman');
});

// ── Bagian 3: satuan detik vs milidetik ──────────────────────────────────
console.log('');
console.log('=== uji: satuan `update` (detik vs milidetik) ===');

uji('update milidetik dan detik menghasilkan umur yang sama', () => {
  const kiniMs = Date.now();
  const ms = kiniMs - 80 * 60 * 1000;
  const detik = Math.floor(ms / 1000);
  const umurDariMs = (kiniMs - (ms > 1e12 ? ms : ms * 1000)) / 1000;
  const umurDariDetik = (kiniMs - (detik > 1e12 ? detik : detik * 1000)) / 1000;
  assert.ok(Math.abs(umurDariMs - umurDariDetik) < 2,
    'satuan harus dinormalkan: ms=' + Math.round(umurDariMs) + ' dtk vs detik=' + Math.round(umurDariDetik) + ' dtk');
  // Dan keduanya harus menghasilkan peringatan yang sama.
  const hMs = headerLaporanBasi(umurDariMs, null);
  const hDetik = headerLaporanBasi(umurDariDetik, null);
  assert.ok(hMs && hDetik, 'keduanya harus memperingatkan');
});

// ── Bagian 4: hanya laporan yang menyentuh HARI INI ──────────────────────
console.log('');
console.log('=== uji: peringatan hanya untuk rentang yang menyentuh hari ini ===');

const hariIni = ymdLokal(0);
const kemarin = ymdLokal(-1);
const bekuMs4 = Date.now() - 92 * 60 * 1000;

uji('laporan HARI INI yang beku -> DIPERINGATKAN', () => {
  const h = peringatanBasiLaporan(
    { update: bekuMs4, dari: hariIni, sampai: hariIni }, hariIni, hariIni,
  );
  assert.ok(h && /BEKU/.test(h), 'laporan hari ini yang beku wajib diperingatkan');
});

uji('laporan TANGGAL LAMPAU -> TIDAK diperingatkan (memang tua, tapi lengkap)', () => {
  const h = peringatanBasiLaporan(
    { update: bekuMs4, dari: kemarin, sampai: kemarin }, kemarin, kemarin,
  );
  assert.strictEqual(h, '',
    'laporan tanggal lampau tidak boleh disambut "LAPORAN BEKU" — peringatan yang selalu menyala akan diabaikan');
});

uji('rentang yang BERAKHIR hari ini -> DIPERINGATKAN', () => {
  const h = peringatanBasiLaporan(
    { update: bekuMs4, dari: kemarin, sampai: hariIni }, kemarin, hariIni,
  );
  assert.ok(h && /BEKU/.test(h), 'rentang yang menyentuh hari ini masih bisa bertambah, wajib diperingatkan');
});

uji('laporan hari ini yang SEGAR -> TIDAK diperingatkan', () => {
  const h = peringatanBasiLaporan(
    { update: Date.now() - 20000, dari: hariIni, sampai: hariIni }, hariIni, hariIni,
  );
  assert.strictEqual(h, '');
});

uji('`sampai` diambil dari ISI laporan, bukan dari argumen', () => {
  // Bila isi laporan menyebut tanggal lampau, itu yang menang — supaya laporan
  // lampau tidak ikut diperingatkan hanya karena pengguna membuka menu hari ini.
  const h = peringatanBasiLaporan(
    { update: bekuMs4, dari: kemarin, sampai: kemarin }, hariIni, hariIni,
  );
  assert.strictEqual(h, '', 'isi laporan yang menentukan, bukan tanggal yang diminta');
});

uji('umurLaporanDetik menormalkan detik dan milidetik', () => {
  const kini = Date.now();
  const ms = kini - 92 * 60 * 1000;
  const umurMs = umurLaporanDetik({ update: ms });
  const umurDetik = umurLaporanDetik({ update: Math.floor(ms / 1000) });
  assert.ok(Math.abs(umurMs - umurDetik) < 2,
    'satuan harus dinormalkan: ms=' + Math.round(umurMs) + ' vs detik=' + Math.round(umurDetik));
});

console.log('');
console.log('  lulus ' + lulus + '/' + (lulus + gagal));
if (gagal) { console.log('  ADA YANG GAGAL'); process.exit(1); }
console.log('  SEMUA LULUS');

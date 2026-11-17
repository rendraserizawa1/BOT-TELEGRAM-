'use strict';
/**
 * Tes: antrean BERISI BANYAK NOTA dipindahkan SEMUA, tidak ada yang hilang.
 *
 * KENAPA TES INI PERLU
 * --------------------
 * Uji satu nota membuktikan jalurnya bekerja, tetapi tidak membuktikan bahwa
 * TIDAK ADA YANG HILANG saat antrean menumpuk — dan itu justru yang terjadi di
 * produksi (nota menumpuk berhari-hari sebelum penjemput ada).
 *
 * Yang diuji:
 *   1. 12 nota dengan nama & ukuran BERBEDA dipindahkan semuanya
 *   2. Setiap berkas di share IDENTIK byte-per-byte dengan aslinya
 *   3. Tidak ada yang tertinggal di antrean
 *   4. Tidak ada berkas tertukar (nama A berisi isi B)
 *   5. Berkas uji dibersihkan
 *
 * Jalankan: node boot/test-jemput-nota-banyak.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const notaMod = require('./nota-simpan.js');

let gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) console.log('  PASS  ' + nama);
  else { console.error('  GAGAL ' + nama + (detail !== undefined ? ' -> ' + detail : '')); gagal++; }
}

const SHARE = '\\\\100.125.99.99\\E\\TOKO NASIONAL KITCHEN\\Nota Toko Nasional Kitchen\\Nota bulan november 2026';
if (!fs.existsSync(SHARE)) {
  console.error('  Share tidak terjangkau dari sini; jalankan di PC yang punya jalur ke share.');
  process.exit(0);
}

const akarUji = fs.mkdtempSync(path.join(os.tmpdir(), 'nota-banyak-'));
const antre = path.join(akarUji, 'nota-gagal');
const tanda = 'ZZ-UJI-BANYAK-' + Date.now() + '-';

// 12 nota, tiap satu isi BERBEDA supaya tertukar pun ketahuan.
const nota = [];
for (let i = 0; i < 12; i++) {
  const nama = tanda + String(i).padStart(2, '0') + '.jpg';
  // Isi berbeda per nota, termasuk byte >= 0x80 yang rusak kalau lewat utf8.
  const isi = Buffer.concat([
    Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
    crypto.createHash('sha256').update('nota-' + i).digest(),
    Buffer.from([0x80, 0xFE, i]),
  ]);
  nota.push({ nama, isi });
  const r = notaMod.simpanKeAntrean(antre, nama, isi, 'uji banyak', SHARE);
  if (!r.ok) { console.error('  GAGAL menaruh ' + nama + ': ' + r.error); gagal++; }
}

console.log('\n=== 1. ANTREAN BERISI 12 NOTA ===');
const daftar = notaMod.daftarAntrean(antre);
cek('1: antrean berisi 12 nota', daftar.length === 12, daftar.length);

console.log('\n=== 2. PINDAHKAN SEMUA (seperti yang dilakukan agen) ===');
let dipindah = 0;
for (const n of daftar) {
  if (!notaMod.tujuanNotaSah(n.tujuan, '')) {
    console.error('    tujuan ditolak: ' + n.tujuan);
    continue;
  }
  const isi = fs.readFileSync(path.join(antre, n.nama));
  const r = notaMod.simpanKeFolder(SHARE, n.nama, isi, { platform: 'win32' });
  if (r.ok) {
    notaMod.hapusDariAntrean(antre, n.nama);
    dipindah++;
  } else {
    console.error('    gagal tulis ' + n.nama + ': ' + r.error);
  }
}
cek('2: 12 nota dipindahkan', dipindah === 12, dipindah);

console.log('\n=== 3. TIDAK ADA YANG TERTINGGAL DI ANTREAN ===');
const sisa = notaMod.daftarAntrean(antre);
cek('3: antrean kosong', sisa.length === 0, JSON.stringify(sisa.map((x) => x.nama)));

console.log('\n=== 4. SEMUA ADA DI SHARE, ISI TIDAK TERTUKAR ===');
let semuaAda = true;
let semuaUtuh = true;
for (const n of nota) {
  const jalur = path.join(SHARE, n.nama);
  if (!fs.existsSync(jalur)) {
    semuaAda = false;
    console.error('    HILANG: ' + n.nama);
    continue;
  }
  const isi = fs.readFileSync(jalur);
  if (!isi.equals(n.isi)) {
    semuaUtuh = false;
    console.error('    ISI TERTUKAR/RUSAK: ' + n.nama);
  }
}
cek('4: 12 berkas ada di share', semuaAda);
cek('4: semua isi identik byte-per-byte (tidak tertukar)', semuaUtuh);

// Pastikan tidak ada nama uji lain yang nyasar (bukti tidak menulis dobel).
const nyasar = fs.readdirSync(SHARE).filter((f) => f.startsWith(tanda) && !nota.some((n) => n.nama === f));
cek('4: tidak ada berkas uji berlebih di share', nyasar.length === 0, nyasar.join(','));

console.log('\n=== 5. BERSIHKAN ===');
let bersih = true;
for (const n of nota) {
  try { fs.unlinkSync(path.join(SHARE, n.nama)); }
  catch (e) { bersih = false; console.error('    gagal hapus ' + n.nama + ': ' + e.message); }
}
cek('5: semua berkas uji dihapus dari share', bersih);
cek('5: share tidak menyisakan berkas uji',
  fs.readdirSync(SHARE).every((f) => !f.startsWith(tanda)));

fs.rmSync(akarUji, { recursive: true, force: true });

if (gagal) { console.error('\n' + gagal + ' GAGAL'); process.exit(1); }
console.log('\nOK jemput-nota-banyak: 12 nota, tidak ada yang hilang atau tertukar');

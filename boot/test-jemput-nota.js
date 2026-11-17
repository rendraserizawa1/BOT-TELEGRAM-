'use strict';
/**
 * Tes: antrean nota BENAR-BENAR bisa dipindahkan oleh PC.
 *
 * MASALAH YANG DIUJI
 * ------------------
 * Pesan ke pengguna berbunyi "Folder share sedang tidak terjangkau; bot akan
 * mencoba memindahkannya otomatis ke folder share". Itu TIDAK PERNAH terjadi:
 * bot berjalan di container Linux, tujuannya share Windows `\\100.125.99.99\E\...`,
 * dan di Linux path UNC bukan path absolut — jadi `sapuAntrean()` di sisi bot
 * selalu gagal. Nota menumpuk di volume selamanya.
 *
 * Perbaikannya: PC (yang punya jalur ke share) menjemput antrean lewat tiga
 * endpoint server. Tes ini menguji bagian yang bisa salah tanpa server:
 *
 *   A. daftarAntrean()  — antrean bisa DIBACA pihak lain, terurut terlama dulu
 *   B. hapusDariAntrean()— hanya nama sah yang boleh dihapus (anti path traversal)
 *   C. tujuanNotaSah()  — tujuan dari server TIDAK dipercaya; hanya akar nota
 *   D. byte gambar TIDAK rusak saat melewati HTTP (bug utf8 vs Buffer)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  daftarAntrean,
  hapusDariAntrean,
  tujuanNotaSah,
  akarNotaSah,
  simpanKeAntrean,
  namaAman,
  AKAR_NOTA_DEFAULT,
} = require('./nota-simpan.js');

let gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) console.log('  PASS  ' + nama);
  else { console.error('  GAGAL ' + nama + (detail !== undefined ? ' -> ' + detail : '')); gagal++; }
}

const akar = fs.mkdtempSync(path.join(os.tmpdir(), 'nota-jemput-'));
const antre = path.join(akar, 'nota-gagal');
const buf = Buffer.from('GAMBAR-NOTA-PALSU');

// ══ A. Antrean bisa dibaca pihak lain, terlama dulu ═════════════════════
simpanKeAntrean(antre, 'ELT 000001-021126.jpg', buf, 'UNC tidak tersedia',
  '\\\\100.125.99.99\\E\\TOKO NASIONAL KITCHEN\\Nota Toko Nasional Kitchen\\Nota bulan november 2026');
simpanKeAntrean(antre, 'KEF 000002-011126.jpg', buf, 'UNC tidak tersedia',
  '\\\\100.125.99.99\\E\\Nota Toko Perabot Mamaku Kefamenanu\\NOVEMBER 2026');

const daftar = daftarAntrean(antre);
cek('A: daftarAntrean membaca 2 nota', daftar.length === 2, JSON.stringify(daftar.map((d) => d.nama)));
cek('A: catatan samping ikut terbaca (tujuan ada)',
  daftar.every((d) => !!d.tujuan), JSON.stringify(daftar.map((d) => d.tujuan)));
cek('A: ukuran ikut terbaca', daftar.every((d) => d.ukuran === buf.length),
  JSON.stringify(daftar.map((d) => d.ukuran)));
cek('A: berkas .json TIDAK ikut terdaftar',
  daftar.every((d) => !d.nama.endsWith('.json')), JSON.stringify(daftar.map((d) => d.nama)));
cek('A: antrean kosong -> daftar kosong',
  daftarAntrean(path.join(akar, 'tidak-ada')).length === 0);

// Terurut: yang paling lama menunggu lebih dulu. Catatan dibuat berurutan,
// jadi urutan nama harus mengikuti urutan penulisan.
const waktu = daftar.map((d) => String(d.waktu || ''));
cek('A: terurut dari yang paling lama', waktu[0] <= waktu[waktu.length - 1], JSON.stringify(waktu));

// ══ B. Hanya nama sah yang boleh dihapus (anti path traversal) ══════════
const rHapusSah = hapusDariAntrean(antre, 'ELT 000001-021126.jpg');
cek('B: hapus nama sah berhasil', rHapusSah.ok === true, JSON.stringify(rHapusSah));
cek('B: nota benar-benar hilang dari disk',
  !fs.existsSync(path.join(antre, 'ELT 000001-021126.jpg')));
cek('B: catatan sampingnya ikut terhapus',
  !fs.existsSync(path.join(antre, 'ELT 000001-021126.jpg.json')));
cek('B: sisa antrean 1', daftarAntrean(antre).length === 1);

// Inilah serangan yang harus ditolak: nama dari query string / server.
const percobaan = [
  '../index.js',
  '..\\index.js',
  '..',
  '',
  'sub/dir.jpg',
  'a\\b.jpg',
];
let semuaDitolak = true;
for (const p of percobaan) {
  const r = hapusDariAntrean(antre, p);
  if (r.ok) { semuaDitolak = false; console.error('    LOLOS (bahaya!): ' + JSON.stringify(p)); }
}
cek('B: nama traversal / kosong DITOLAK semua', semuaDitolak);

// Berkas penting di luar antrean harus tetap ada setelah percobaan di atas.
const penting = path.join(akar, 'index.js');
fs.writeFileSync(penting, 'JANGAN-HAPUS');
hapusDariAntrean(antre, '../index.js');
cek('B: berkas di luar antrean TIDAK terhapus', fs.existsSync(penting));

// ══ C. Tujuan dari server tidak dipercaya ═══════════════════════════════
cek('C: akar bawaan ada 2', AKAR_NOTA_DEFAULT.length === 2, JSON.stringify(AKAR_NOTA_DEFAULT));
cek('C: tujuan di dalam akar NK diterima',
  tujuanNotaSah('\\\\100.125.99.99\\E\\TOKO NASIONAL KITCHEN\\Nota Toko Nasional Kitchen\\Nota bulan november 2026') === true);
cek('C: tujuan di dalam akar KEF diterima',
  tujuanNotaSah('\\\\100.125.99.99\\E\\Nota Toko Perabot Mamaku Kefamenanu\\NOVEMBER 2026') === true);
cek('C: huruf besar/kecil tidak masalah',
  tujuanNotaSah('\\\\100.125.99.99\\e\\toko nasional kitchen\\Nota bulan november 2026') === true);

// Yang HARUS ditolak: server yang disusupi menyuruh PC menulis ke mana saja.
const tujuanJahat = [
  'C:\\Windows\\System32',
  'C:\\Users\\rdpadmin\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup',
  '\\\\100.125.99.99\\E\\TOKO NASIONAL KITCHEN_JANGKIT',
  '\\\\100.125.99.99\\C$\\Windows',
  '\\\\penyerang\\share\\nota',
  '\\\\100.125.99.99\\E\\TOKO NASIONAL KITCHEN\\..\\..\\Windows',
  '/tmp/nota',
  '',
];
let jahatDitolak = true;
for (const t of tujuanJahat) {
  if (tujuanNotaSah(t)) { jahatDitolak = false; console.error('    LOLOS (bahaya!): ' + JSON.stringify(t)); }
}
cek('C: tujuan di luar akar DITOLAK semua', jahatDitolak);

// Akar bisa diatur lewat env; akar lain yang sah harus diterima.
cek('C: akar dari env dipakai bila diisi',
  akarNotaSah('D:\\Nota').length === 1 && akarNotaSah('D:\\Nota')[0] === 'D:\\Nota');
cek('C: env kosong -> akar bawaan', akarNotaSah('').length === 2);
cek('C: tujuan di akar env diterima', tujuanNotaSah('D:\\Nota\\2026\\a.jpg', 'D:\\Nota') === true);

// ══ D. Byte gambar tidak boleh rusak lewat HTTP ═════════════════════════
//
// `minta()` mengubah isi menjadi string UTF-8. Untuk JSON itu benar; untuk
// BERKAS GAMBAR itu merusaknya: byte >= 0x80 diganti U+FFFD sehingga nota
// tidak bisa dibuka. Tes ini membuktikan kerusakan itu nyata, supaya tidak ada
// yang "merapikan" jalur nota kembali memakai minta().
const gambarAsli = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x80, 0xFE]);
const lewatUtf8 = Buffer.from(gambarAsli.toString('utf8'), 'utf8');
cek('D: string utf8 MERUSAK byte gambar (bukti minta() tidak boleh dipakai)',
  !lewatUtf8.equals(gambarAsli), 'harusnya berbeda');
cek('D: Buffer mentah utuh',
  Buffer.concat([gambarAsli]).equals(gambarAsli));

// Simulasi persis yang dilakukan agen: terima Buffer -> simpanKeFolder.
const share = path.join(akar, 'share');
const notaMod = require('./nota-simpan.js');
const rTulis = notaMod.simpanKeFolder(share, 'ELT 000009-021126.jpg', gambarAsli, { platform: process.platform });
cek('D: simpanKeFolder menerima Buffer dan berhasil', rTulis.ok === true, JSON.stringify(rTulis));
cek('D: isi file di share IDENTIK dengan aslinya',
  fs.readFileSync(rTulis.path).equals(gambarAsli),
  fs.readFileSync(rTulis.path).toString('hex'));
cek('D: tidak ada sisa .part', fs.readdirSync(share).every((f) => !f.endsWith('.part')),
  fs.readdirSync(share).join(','));

// ══ E. Regresi: perilaku lama tidak berubah ═════════════════════════════
cek('E: namaAman masih ramah nama nota', namaAman('ELT 000001-021126.jpg') === 'ELT 000001-021126.jpg');
cek('E: namaAman masih membuang traversal', namaAman('../../etc/passwd') === 'passwd');

fs.rmSync(akar, { recursive: true, force: true });

if (gagal) { console.error('\n' + gagal + ' GAGAL'); process.exit(1); }
console.log('\nOK jemput-nota: A + B + C + D + E');

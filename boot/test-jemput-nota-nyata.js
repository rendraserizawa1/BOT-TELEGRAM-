'use strict';
/**
 * Tes UJUNG-KE-UJUNG: PC benar-benar memindahkan nota ke share SUNGGUHAN.
 *
 * Tes unit (test-jemput-nota.js) hanya membuktikan logikanya benar di folder
 * sementara. Tes ini membuktikan hal yang dikeluhkan pengguna: nota yang
 * tertahan di antrean akhirnya MUNCUL di folder share Windows.
 *
 * Yang diuji, berurutan:
 *   1. Share tujuan benar-benar bisa ditulisi dari PC ini
 *   2. Nota buatan ditulis ke share lewat jalur yang sama dengan agen
 *   3. Isinya IDENTIK byte-per-byte (bukan rusak karena utf8)
 *   4. Nota dihapus dari antrean HANYA setelah tulis berhasil
 *   5. Berkas uji dibersihkan (tidak mengotori share toko)
 *
 * Jalankan: node boot/test-jemput-nota-nyata.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const notaMod = require('./nota-simpan.js');

let gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) console.log('  PASS  ' + nama);
  else { console.error('  GAGAL ' + nama + (detail !== undefined ? ' -> ' + detail : '')); gagal++; }
}

// Share sungguhan yang dipakai produksi.
const SHARE_NK = '\\\\100.125.99.99\\E\\TOKO NASIONAL KITCHEN\\Nota Toko Nasional Kitchen\\Nota bulan november 2026';
const SHARE_KEF = '\\\\100.125.99.99\\E\\Nota Toko Perabot Mamaku Kefamenanu\\NOVEMBER 2026';

console.log('=== 1. SHARE TERJANGKAU? ===');
const adaNK = fs.existsSync(SHARE_NK);
const adaKEF = fs.existsSync(SHARE_KEF);
console.log('  NK  : ' + adaNK + '  ' + SHARE_NK);
console.log('  KEF : ' + adaKEF + '  ' + SHARE_KEF);

if (!adaNK && !adaKEF) {
  console.error('\n  Share tidak terjangkau dari sini. Tes ini harus dijalankan di PC');
  console.error('  yang punya jalur ke share (BCODE-KEFA). Bukan kegagalan kode.');
  process.exit(0);
}

// Nama uji yang jelas bukan nota sungguhan, supaya tidak tertukar.
const namaUji = 'ZZ-UJI-BCODE-' + Date.now() + '.jpg';
// Byte JPEG asli: header + byte >= 0x80 yang PASTI rusak kalau lewat utf8.
const byteUji = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x80, 0xFE, 0xC0, 0xFF, 0xEE]);

const akarUji = fs.mkdtempSync(path.join(os.tmpdir(), 'nota-nyata-'));
const antre = path.join(akarUji, 'nota-gagal');
const tujuan = adaNK ? SHARE_NK : SHARE_KEF;

console.log('\n=== 2. NOTA MASUK ANTREAN (seperti saat share tidak terjangkau) ===');
const rAntre = notaMod.simpanKeAntrean(antre, namaUji, byteUji, 'uji ujung-ke-ujung', tujuan);
cek('2: nota masuk antrean', rAntre.ok === true, JSON.stringify(rAntre));
cek('2: antrean berisi 1 nota', notaMod.daftarAntrean(antre).length === 1);

console.log('\n=== 3. PC MENJEMPUT DAN MENULIS KE SHARE ===');
const daftar = notaMod.daftarAntrean(antre);
cek('3: tujuan dari antrean lolos batas keamanan',
  notaMod.tujuanNotaSah(daftar[0].tujuan, ''), daftar[0].tujuan);

const isiAntre = fs.readFileSync(path.join(antre, namaUji));
cek('3: isi di antrean identik dengan aslinya', isiAntre.equals(byteUji));

const rTulis = notaMod.simpanKeFolder(tujuan, namaUji, isiAntre, { platform: 'win32' });
cek('3: tulis ke share BERHASIL', rTulis.ok === true, JSON.stringify(rTulis));

const jalurShare = path.join(tujuan, namaUji);
cek('3: berkas MUNCUL di folder share', fs.existsSync(jalurShare), jalurShare);
if (fs.existsSync(jalurShare)) {
  const isiShare = fs.readFileSync(jalurShare);
  cek('3: isi di share IDENTIK byte-per-byte', isiShare.equals(byteUji),
    'asli=' + byteUji.toString('hex') + ' share=' + isiShare.toString('hex'));
  cek('3: ukuran sama', isiShare.length === byteUji.length,
    isiShare.length + ' vs ' + byteUji.length);
}
// Yang diperiksa HANYA sisa .part milik berkas uji ini.
// Memeriksa SELURUH folder membuat tes rapuh: agen produksi di PC yang sama
// sedang memindahkan nota sungguhan dan sesaat menulis `.part`-nya sendiri.
// Kegagalan yang muncul lalu bukan bug kode, melainkan tabrakan waktu.
cek('3: tidak ada sisa .part untuk berkas uji ini',
  !fs.existsSync(path.join(tujuan, '.' + namaUji + '.part')),
  fs.readdirSync(tujuan).filter((f) => f.startsWith('.')).join(','));

console.log('\n=== 4. HAPUS DARI ANTREAN SETELAH TERBUKTI TERSIMPAN ===');
const rHapus = notaMod.hapusDariAntrean(antre, namaUji);
cek('4: hapus dari antrean berhasil', rHapus.ok === true, JSON.stringify(rHapus));
cek('4: antrean jadi kosong', notaMod.daftarAntrean(antre).length === 0);

console.log('\n=== 5. BERSIHKAN BERKAS UJI DARI SHARE ===');
try {
  fs.unlinkSync(jalurShare);
  console.log('  PASS  berkas uji dihapus dari share');
} catch (e) {
  console.error('  GAGAL gagal hapus berkas uji: ' + e.message + ' -> ' + jalurShare);
  gagal++;
}
cek('5: share bersih dari berkas uji', !fs.existsSync(jalurShare));

fs.rmSync(akarUji, { recursive: true, force: true });

if (gagal) { console.error('\n' + gagal + ' GAGAL'); process.exit(1); }
console.log('\nOK jemput-nota-nyata: nota tertahan BENAR-BENAR mendarat di share');

'use strict';
/**
 * BUKTI bahwa uji peringatan laporan beku BENAR-BENAR menangkap bug.
 *
 * Uji yang lulus pada kode rusak tidak membuktikan apa pun. Skrip ini:
 *   1. menyalin index.js,
 *   2. menghapus pemakaian `headerLaporanBasi` di blok laporan kasir
 *      (meniru kode lama yang tidak memperingatkan kebekuan),
 *   3. menjalankan uji -> HARUS gagal,
 *   4. memulihkan index.js -> uji HARUS lulus.
 *
 * Selalu memulihkan berkas di blok finally.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BERKAS = path.join(ROOT, 'index.js');

function jalankan() {
  try {
    const o = execFileSync(process.execPath, [path.join(__dirname, 'test-peringatan-laporan-beku.js')], {
      cwd: ROOT, encoding: 'utf8',
    });
    return { kode: 0, keluaran: o };
  } catch (e) {
    return { kode: e.status == null ? 1 : e.status, keluaran: String((e.stdout || '') + (e.stderr || '')) };
  }
}

function ringkas(keluaran) {
  return keluaran.split(/\r?\n/).filter((x) => /GAGAL|lulus |SEMUA/.test(x)).map((x) => '  ' + x.trim()).join('\n');
}

const asli = fs.readFileSync(BERKAS, 'utf8');
let hasil = 1;
try {
  // Cari blok: dari `const basiKasir = peringatanBasiLaporan(` sampai baris
  // `if (basiKasir) lines.push(basiKasir);` (inklusif).
  const awal = asli.indexOf('const basiKasir = peringatanBasiLaporan(');
  if (awal < 0) throw new Error('basiKasir tidak ditemukan');
  const akhirPenanda = 'if (basiKasir) lines.push(basiKasir);';
  const akhir = asli.indexOf(akhirPenanda, awal);
  if (akhir < 0) throw new Error('pemakaian basiKasir tidak ditemukan');
  const potong = asli.slice(0, awal) + asli.slice(akhir + akhirPenanda.length);

  fs.writeFileSync(BERKAS, potong, 'utf8');
  const lama = jalankan();
  console.log('--- KODE LAMA (tanpa peringatan di laporan kasir) exit ' + lama.kode + ' ---');
  console.log(ringkas(lama.keluaran));

  fs.writeFileSync(BERKAS, asli, 'utf8');
  const baru = jalankan();
  console.log('--- KODE BARU (dengan peringatan) exit ' + baru.kode + ' ---');
  console.log(ringkas(baru.keluaran));

  const benar = lama.kode !== 0 && baru.kode === 0;
  console.log('');
  console.log(benar
    ? '  TERBUKTI: uji GAGAL tanpa peringatan, LULUS dengan peringatan.'
    : '  TIDAK TERBUKTI: uji tidak membedakan -> uji tidak berguna.');
  hasil = benar ? 0 : 1;
} finally {
  fs.writeFileSync(BERKAS, asli, 'utf8');
  const pulih = fs.readFileSync(BERKAS, 'utf8');
  console.log('  index.js dipulihkan: ' + (pulih === asli ? 'YA' : 'TIDAK'));
  if (pulih !== asli) hasil = 1;
}
process.exit(hasil);

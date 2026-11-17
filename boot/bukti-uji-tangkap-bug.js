'use strict';
/**
 * ALAT BANTU UJI: kembalikan `laporanDorong` ke perilaku LAMA, lalu jalankan
 * uji rentang. Dipakai untuk membuktikan uji itu BENAR-BENAR menangkap bug
 * (uji yang lulus pada kode rusak tidak membuktikan apa pun).
 *
 * Tidak dipakai di produksi. Tidak menyentuh berkas permanen: aslinya disalin
 * dulu, dan selalu dipulihkan di blok finally.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BERKAS = path.join(ROOT, 'ipos-bridge.js');
const CADANGAN = path.join(ROOT, 'boot', '.ipos-bridge.asli.js');

// Fungsi LAMA: selalu menolak rentang selain hari ini. Ini penyebab bug
// "marketplace 14/11 kosong".
const LAMA = [
  '  function laporanDorong(jenis, dari, sampai) {',
  "    const data = pushGudang.ambilSegar(tokoUtama, jenis, PUSH_BATAS_LAPORAN_DETIK);",
  "    if (!data || typeof data !== 'object') {",
  '      const umur = pushGudang.umurDetik(tokoUtama, jenis);',
  '      throw new Error(umur == null',
  '        ? `belum ada laporan ${jenis} dorongan dari PC`',
  '        : `laporan ${jenis} dorongan basi (${umur} dtk)`);',
  '    }',
  "    const d1 = String(data.dari || '').slice(0, 10);",
  "    const d2 = String(data.sampai || '').slice(0, 10);",
  "    const minta1 = String(dari || '').slice(0, 10);",
  "    const minta2 = String(sampai || dari || '').slice(0, 10);",
  '    if (d1 && d2 && (minta1 !== d1 || minta2 !== d2)) {',
  '      throw new Error(',
  '        `laporan ${jenis} dorongan hanya tersedia untuk ${d1} s/d ${d2}, `',
  '        + `bukan ${minta1} s/d ${minta2}`);',
  '    }',
  '    const upd = Number(data.update);',
  '    if (Number.isFinite(upd) && upd > 0) lapUpdateTerakhir = upd > 1e12 ? upd : upd * 1000;',
  '    return data;',
  '  }',
  '',
].join('\n');

function jalankanUji(label) {
  let keluar = '';
  let kode = 0;
  try {
    keluar = execFileSync(process.execPath, [path.join(__dirname, 'test-laporan-rentang-lampau.js')], {
      cwd: ROOT, encoding: 'utf8',
    });
  } catch (e) {
    keluar = String((e.stdout || '') + (e.stderr || ''));
    kode = e.status == null ? 1 : e.status;
  }
  const baris = keluar.trim().split(/\r?\n/);
  console.log('--- ' + label + ' (exit ' + kode + ') ---');
  for (const b of baris.filter((x) => /GAGAL|RINGKASAN|lulus:|SEMUA/.test(x))) {
    console.log('  ' + b.trim());
  }
  return kode;
}

const asli = fs.readFileSync(BERKAS, 'utf8');
fs.writeFileSync(CADANGAN, asli, 'utf8');
let hasil = 1;
try {
  const awal = asli.indexOf('  function laporanDorong(jenis, dari, sampai) {');
  const akhir = asli.indexOf('  async function ambilLaporan(url, fresh = false');
  if (awal < 0 || akhir < 0) throw new Error('batas fungsi laporanDorong tidak ditemukan');
  fs.writeFileSync(BERKAS, asli.slice(0, awal) + LAMA + asli.slice(akhir), 'utf8');

  const kodeLama = jalankanUji('KODE LAMA (harus GAGAL = menangkap bug)');
  fs.writeFileSync(BERKAS, asli, 'utf8');
  const kodeBaru = jalankanUji('KODE BARU (harus LULUS)');

  console.log('');
  const benar = kodeLama !== 0 && kodeBaru === 0;
  console.log(benar
    ? '  TERBUKTI: uji GAGAL pada kode lama dan LULUS pada kode baru.'
    : '  TIDAK TERBUKTI: uji tidak membedakan kode lama dan baru -> uji tidak berguna.');
  hasil = benar ? 0 : 1;
} finally {
  fs.writeFileSync(BERKAS, asli, 'utf8');
  try { fs.unlinkSync(CADANGAN); } catch (_) { /* abaikan */ }
  // Pastikan berkas benar-benar pulih.
  const pulih = fs.readFileSync(BERKAS, 'utf8');
  console.log('  ipos-bridge.js dipulihkan: ' + (pulih === asli ? 'YA' : 'TIDAK'));
  if (pulih !== asli) hasil = 1;
}
process.exit(hasil);

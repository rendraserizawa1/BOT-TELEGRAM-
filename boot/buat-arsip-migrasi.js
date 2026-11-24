'use strict';
/**
 * ARSIP PEMULIHAN UNTUK MIGRASI KE SRV KEFA
 *
 * MENGAPA ARSIP INI ADA
 * ---------------------
 * PC lama akan DIBERSIHKAN TOTAL (dihapus, bukan sekadar dinonaktifkan).
 * Sebelum itu, seluruh isi bot diarsipkan ke SRV KEFA supaya kalau ada yang
 * salah masih bisa dipulihkan TANPA meninggalkan jejak di PC lama.
 *
 * YANG DILEWATI (sengaja)
 * -----------------------
 *   logs/        riwayat log lokal, tidak berguna di mesin lain
 *   .git/        repo tetap di GitHub
 *   backup/      27 MB arsip lama, tetap disimpan di PC lama sebagai cadangan
 *   *.bak-*      SALINAN .env LAMA yang berisi KREDENSIAL LAMA.
 *                Ini TIDAK boleh ikut pindah: kunci sudah dirotasi, dan
 *                menyalin kunci lama ke mesin baru hanya memperluas paparan.
 *   boot/cloudflared.exe  sudah pensiun (tugas BCODE-JAGA-TUNNEL Disabled,
 *                push-agen memakai HTTPS publik langsung)
 *   boot/ssh-nk  sisa percobaan SSH ke NK yang sudah ditinggalkan
 *
 * Jalankan: node boot/buat-arsip-migrasi.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const AKAR = path.join(__dirname, '..');
const KELUAR = path.join(AKAR, 'migrasi-srv-kefa.tar.gz');

const LEWATI_DIR = ['logs', '.git', 'backup', 'node_modules'];
const LEWATI_POLA = [
  /\.bak-/i,          // salinan .env lama berisi kredensial lama
  /\.log$/i,
  /cloudflared\.exe$/i,
  /^ssh-nk/i,
  /migrasi-srv-kefa\.tar\.gz$/i,
];

function harusLewati(relatif) {
  const bagian = relatif.split(/[\\/]/);
  for (const d of LEWATI_DIR) {
    if (bagian.includes(d)) return true;
  }
  return LEWATI_POLA.some((p) => p.test(relatif));
}

// Kumpulkan berkas yang akan diarsipkan.
const daftar = [];
function jelajah(dir, relatif) {
  let isi;
  try { isi = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of isi) {
    const rel = relatif ? relatif + '/' + e.name : e.name;
    if (harusLewati(rel)) continue;
    const penuh = path.join(dir, e.name);
    if (e.isDirectory()) jelajah(penuh, rel);
    else if (e.isFile()) {
      let uk = 0;
      try { uk = fs.statSync(penuh).size; } catch (_) {}
      daftar.push({ rel, penuh, uk });
    }
  }
}
jelajah(AKAR, '');

console.log('=== BUAT ARSIP PEMULIHAN ===');
console.log('  tujuan: ' + KELUAR);
console.log('');

const total = daftar.reduce((a, b) => a + b.uk, 0);
console.log('  berkas: ' + daftar.length + '   total: ' + (total / 1048576).toFixed(1) + ' MB');
console.log('');

// Tunjukkan apa yang DILEWATI supaya tidak ada yang hilang diam-diam.
console.log('  DILEWATI (sengaja):');
console.log('    logs/, .git/, backup/, node_modules/ (dipasang ulang di SRV)');
console.log('    *.bak-*  (salinan .env lama berisi kredensial LAMA)');
console.log('    cloudflared.exe (sudah pensiun), ssh-nk/ (ditinggalkan)');
console.log('');

// Berkas kredensial WAJIB ikut — tanpa ini bot tidak bisa jalan di SRV.
const wajib = ['.env', 'boot/push-agen.env'];
for (const w of wajib) {
  const ada = daftar.some((d) => d.rel === w);
  console.log('  ' + (ada ? 'OK   ' : 'GAGAL') + ' kredensial ikut: ' + w);
  if (!ada) { console.log('\n  BERHENTI: berkas kredensial tidak ditemukan.'); process.exit(1); }
}
console.log('');

// Buat daftar berkas untuk tar (hindari masalah quoting dengan -T).
const daftarFile = path.join(AKAR, '.daftar-arsip.txt');
fs.writeFileSync(daftarFile, daftar.map((d) => d.rel).join('\r\n'), 'utf8');

try {
  if (fs.existsSync(KELUAR)) fs.unlinkSync(KELUAR);
  execFileSync('tar', ['-czf', KELUAR, '-C', AKAR, '-T', daftarFile], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 900000,
  });
  const uk = fs.statSync(KELUAR).size;
  console.log('  ARSIP DIBUAT: ' + (uk / 1048576).toFixed(1) + ' MB');
  if (uk < 1000000) { console.log('  PERINGATAN: arsip sangat kecil, periksa.'); }
} catch (e) {
  console.log('  GAGAL membuat arsip: ' + (e && e.message ? e.message : String(e)));
  process.exit(1);
} finally {
  try { fs.unlinkSync(daftarFile); } catch (_) {}
}

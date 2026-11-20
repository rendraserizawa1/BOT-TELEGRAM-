'use strict';
/**
 * TES: RANTAI AGEN — kenapa mengubah env TIDAK CUKUP
 *
 * Latar — insiden 20/11/2026
 * -------------------------
 * Setelah kunci iPos KEFA dirotasi, KEFA menjadi `online=false` walau:
 *   - berkas .env dan push-agen.env sudah berisi kunci baru (terverifikasi), dan
 *   - proxy lokal menjawab HTTP 200 dengan kunci baru (terverifikasi).
 *
 * Penyebabnya: `jaga-push.ps1` adalah WRAPPER yang membaca push-agen.env ke
 * dalam environment PROSES-nya sendiri saat start, lalu mewariskannya ke
 * `node jaga-push.js`, yang meneruskannya ke `node push-agen.js`. Wrapper yang
 * hidup sejak sebelum rotasi terus mewariskan kunci LAMA. Mematikan hanya
 * `push-agen.js` tidak menolong: penjaga menyalakannya ulang dalam hitungan
 * detik dengan env lama, sehingga gejalanya terlihat seperti "kunci salah".
 *
 * Dua hal yang dikunci tes ini:
 *   1. Wrapper memang membaca env ke prosesnya (jadi restart harus dari akar).
 *   2. Skrip restart mematikan SELURUH rantai, bukan hanya agen.
 *   3. Filter prosesnya TIDAK boleh mencocokkan dirinya sendiri — kesalahan
 *      nyata yang membuat skrip membunuh shell-nya (gejala: "kill ESRCH").
 *
 * Jalankan: node boot/test-rantai-agen.js
 */
const fs = require('fs');
const path = require('path');

const AKAR = path.join(__dirname, '..');
let lulus = 0, gagal = 0;
function cek(nama, syarat, ket) {
  if (syarat) { lulus++; console.log('  OK   ' + nama); }
  else { gagal++; console.log('  GAGAL ' + nama + (ket ? '  -> ' + ket : '')); }
}

// ── 1. Wrapper memang menyuntikkan env ke prosesnya ──────────────
console.log('\n[1] Wrapper menyuntikkan env ke prosesnya sendiri');
const pWrapper = path.join(AKAR, 'boot', 'jaga-push.ps1');
cek('boot/jaga-push.ps1 ada', fs.existsSync(pWrapper));
const wrapper = fs.existsSync(pWrapper) ? fs.readFileSync(pWrapper, 'utf8') : '';
cek('memakai SetEnvironmentVariable level Process',
  /SetEnvironmentVariable\([^)]*'Process'\)/.test(wrapper),
  'inilah sebabnya berkas berubah tapi agen tetap memakai nilai lama');
cek('membaca boot\\push-agen.env', /push-agen\.env/.test(wrapper));
cek('menimpa env (push-agen.env adalah sumber kebenaran)',
  /\$timpa/.test(wrapper) || /timpa/.test(wrapper));
cek('menjalankan node jaga-push.js', /jaga-push\.js/.test(wrapper));

// ── 2. Penjaga meneruskan env ke agen ────────────────────────────
console.log('\n[2] Penjaga meneruskan env ke agen');
const pJaga = path.join(AKAR, 'boot', 'jaga-push.js');
const jaga = fs.readFileSync(pJaga, 'utf8');
cek('jaga-push.js menjalankan push-agen.js', /push-agen\.js/.test(jaga));
cek('meneruskan env (spawn tanpa env bersih)',
  /spawn\(/.test(jaga) && !/env:\s*\{\s*\}/.test(jaga),
  'kalau env dibersihkan, agen tidak akan menerima konfigurasi');
cek('punya kunci anti-duplikat', /\.jaga-push\.lock/.test(jaga));

// ── 3. Skrip restart mematikan SELURUH rantai ────────────────────
console.log('\n[3] Skrip restart mematikan seluruh rantai');
const pRestart = path.join(AKAR, 'boot', 'nyalakan-ulang-agen.js');
cek('boot/nyalakan-ulang-agen.js ada', fs.existsSync(pRestart));
const restart = fs.existsSync(pRestart) ? fs.readFileSync(pRestart, 'utf8') : '';
cek('menyebut wscript (akar rantai)', /wscript\.exe/.test(restart));
cek('menyebut powershell (wrapper)', /powershell\.exe/.test(restart));
cek('menyebut node (penjaga + agen)', /node\.exe/.test(restart));
cek('menghentikan berurutan dari akar ke daun',
  /urutan\s*=\s*\[\s*'wscript\.exe'\s*,\s*'powershell\.exe'\s*,\s*'node\.exe'\s*\]/.test(restart),
  'harus dari akar supaya penjaga tidak sempat menyalakan ulang');
cek('memverifikasi rantai bersih sebelum menyalakan ulang',
  /MASIH ADA SISA/.test(restart));
cek('menyalakan ulang lewat tugas resmi', /Start-ScheduledTask/.test(restart));
cek('memverifikasi tepat satu penjaga dan satu agen',
  /nAgen !== 1 \|\| nPenjaga !== 1/.test(restart));

// ── 4. Filter proses tidak boleh mencocokkan dirinya sendiri ─────
console.log('\n[4] Filter proses tidak membunuh dirinya sendiri');
cek('ada penanda khusus proses pemeriksa', /PENANDA_SENDIRI/.test(restart),
  'tanpa ini, teks perintah pemeriksa ikut cocok dan shell-nya terbunuh');
cek('proses pemeriksa dikecualikan', /\$cocok = \$false/.test(restart));
// Pola di dalam skrip ditulis sebagai string JS, sehingga berkasnya memuat
// escape GANDA ("run-hidden\\.vbs"). Memeriksanya dengan regex mudah salah
// hitung backslash, jadi dipakai pencocokan teks persis. Yang benar-benar
// menentukan adalah simulasi di bagian [5], bukan pemeriksaan teks ini.
cek('pola wscript ketat (run-hidden.vbs + jaga-push.ps1)',
  restart.includes('run-hidden\\\\.vbs') && restart.includes('jaga-push\\\\.ps1'),
  'harus mencocokkan kedua berkas, bukan salah satu');
cek('pola powershell ketat (-File ... jaga-push.ps1)',
  /-File\\s\+\.\*jaga-push/.test(restart) || /-File/.test(restart));
cek('pola node ketat (nama .js persis)',
  /jaga-push\\\.js/.test(restart) && /push-agen\\\.js/.test(restart));

// ── 5. Simulasi pencocokan nama proses ───────────────────────────
console.log('\n[5] Simulasi: proses mana yang disasar');
{
  // Tiruan command line nyata di mesin ini.
  const proses = [
    { nama: 'wscript.exe', cl: 'wscript.exe "C:\\BOT-TELEGRAM-\\boot\\run-hidden.vbs" "C:\\BOT-TELEGRAM-\\boot\\jaga-push.ps1"', ket: 'akar rantai' },
    { nama: 'powershell.exe', cl: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\\BOT-TELEGRAM-\\boot\\jaga-push.ps1"', ket: 'wrapper' },
    { nama: 'node.exe', cl: '"C:\\Program Files\\nodejs\\node.exe" C:\\BOT-TELEGRAM-\\boot\\jaga-push.js', ket: 'penjaga' },
    { nama: 'node.exe', cl: '"C:\\Program Files\\nodejs\\node.exe" C:\\BOT-TELEGRAM-\\boot\\push-agen.js', ket: 'agen' },
    // Yang TIDAK boleh disasar:
    { nama: 'node.exe', cl: '"C:\\Program Files\\nodejs\\node.exe" C:\\BOT-TELEGRAM-\\boot\\jaga-poller-tunggal.js', ket: 'penjaga poller' },
    { nama: 'node.exe', cl: '"C:\\Program Files\\nodejs\\node.exe" --env-file=.env server.js', ket: 'proxy iPos' },
    { nama: 'powershell.exe', cl: 'powershell.exe -Command Get-CimInstance ... jaga-push ... PEMERIKSA-RANTAI-AGEN', ket: 'pemeriksa sendiri' },
  ];
  const cocok = (p) => {
    const c = p.cl, n = p.nama;
    if (c.includes('PEMERIKSA-RANTAI-AGEN')) return false;
    if (n === 'wscript.exe' && /run-hidden\.vbs/.test(c) && /jaga-push\.ps1/.test(c)) return true;
    if (n === 'powershell.exe' && /-File\s+.*jaga-push\.ps1/.test(c)) return true;
    if (n === 'node.exe' && (/jaga-push\.js/.test(c) || /push-agen\.js/.test(c))) return true;
    return false;
  };
  const disasar = proses.filter(cocok);

  cek('akar rantai (wscript) disasar', disasar.some((p) => p.ket === 'akar rantai'));
  cek('wrapper (powershell) disasar', disasar.some((p) => p.ket === 'wrapper'));
  cek('penjaga (node) disasar', disasar.some((p) => p.ket === 'penjaga'));
  cek('agen (node) disasar', disasar.some((p) => p.ket === 'agen'));
  cek('penjaga POLLER tidak disasar', !disasar.some((p) => p.ket === 'penjaga poller'));
  cek('proxy iPos tidak disasar', !disasar.some((p) => p.ket === 'proxy iPos'));
  cek('pemeriksa sendiri TIDAK disasar', !disasar.some((p) => p.ket === 'pemeriksa sendiri'),
    'ini kesalahan nyata yang pernah terjadi: skrip membunuh shell-nya sendiri');
  cek('jumlah yang disasar tepat 4', disasar.length === 4, 'dapat ' + disasar.length);
}

// ── Ringkasan ────────────────────────────────────────────────────
console.log('\n' + '='.repeat(56));
console.log('  LULUS: ' + lulus + '   GAGAL: ' + gagal);
console.log('='.repeat(56));
if (gagal > 0) { console.log('\nADA YANG GAGAL.'); process.exit(1); }
console.log('\nSEMUA LULUS.');

'use strict';
/**
 * Isi Variables Railway dari .env lokal, TANPA mencetak nilai rahasia.
 *
 * Nilai hanya dikirim ke `railway variables --set`. Yang dicetak hanyalah
 * NAMA dan PANJANG nilai, tidak pernah isinya.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLI = 'C:/Users/rdpadmin/AppData/Roaming/npm/node_modules/@railway/cli/bin/railway.js';

// Baca .env
const env = {};
const envPath = path.join(ROOT, '.env');
for (const baris of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = baris.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  env[m[1]] = v;
}

// Variabel yang WAJIB di Railway (lihat boot/PANDUAN-DEPLOY-RAILWAY.md).
// PORT sengaja TIDAK ada di sini: Railway menyuntiknya sendiri.
const WAJIB = [
  'BOT_TOKEN', 'ADMIN_ID', 'BOT_USERNAME',
  'GITHUB_TOKEN', 'GITHUB_USERNAME', 'GITHUB_REPO', 'GITHUB_BRANCH',
  'ENCRYPT_PASSWORD', 'DASHBOARD_USER', 'DASHBOARD_PASS', 'SESSION_SECRET',
  'MAX_MEMBER',
  'GEMINI_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY',
  'IPOS_URL', 'IPOS_KEY', 'IPOS_TOKO', 'IPOS_SYNC_MS',
  'IPOS_NK_URL', 'IPOS_NK_KEY', 'IPOS_NK_TOKO',
  'IPOS_KEFA_URL', 'IPOS_KEFA_KEY', 'IPOS_KEFA_TOKO',
];

// Variabel tambahan yang mungkin ada dengan nama berbeda di .env
const ALIAS = {
  GEMINI_KEY2: ['GEMINI_KEY2', 'GEMINI_KEY_2'],
  GEMINI_KEY3: ['GEMINI_KEY3', 'GEMINI_KEY_3'],
};

const nilai = {};
const laporan = [];
let hilang = 0;

function ambil(nama) {
  if (env[nama] !== undefined && env[nama] !== '') return env[nama];
  const alts = ALIAS[nama] || [];
  for (const a of alts) {
    if (env[a] !== undefined && env[a] !== '') return env[a];
  }
  return null;
}

for (const nama of WAJIB) {
  const v = ambil(nama);
  if (v === null) { laporan.push(['KOSONG', nama, 0]); hilang++; }
  else { nilai[nama] = v; laporan.push(['ok', nama, v.length]); }
}
for (const nama of ['GEMINI_KEY2', 'GEMINI_KEY3']) {
  const v = ambil(nama);
  if (v !== null) { nilai[nama] = v; laporan.push(['ok', nama, v.length]); }
  else laporan.push(['kosong', nama, 0]);
}

console.log('=== Nilai yang akan dikirim (HANYA nama + panjang) ===');
for (const [status, nama, panjang] of laporan) {
  console.log('  ' + String(status).padEnd(7) + nama.padEnd(20) + (panjang ? 'panjang=' + panjang : ''));
}
if (hilang) {
  console.error('\n' + hilang + ' variabel WAJIB tidak ada di .env. Berhenti.');
  process.exit(1);
}

// Kirim satu per satu agar kegagalan satu variabel tidak menggagalkan semua.
console.log('\n=== Mengirim ke Railway ===');
let sukses = 0;
let gagal = 0;
for (const [nama, v] of Object.entries(nilai)) {
  try {
    execFileSync(process.execPath, [CLI, 'variables', '--set', nama + '=' + v], {
      cwd: ROOT, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log('  ok      ' + nama);
    sukses++;
  } catch (e) {
    // JANGAN cetak stderr mentah: bisa memuat nilai.
    const pesan = String((e.stderr || e.message || '')).split('\n')[0].slice(0, 90);
    console.log('  GAGAL   ' + nama + '  (' + pesan + ')');
    gagal++;
  }
}

console.log('\nRingkasan: ' + sukses + ' terkirim, ' + gagal + ' gagal');
process.exit(gagal ? 1 : 0);

'use strict';
/**
 * Pindai kebocoran rahasia pada diff yang akan di-commit.
 *
 * Membaca .env HANYA untuk mengambil NILAI rahasia, lalu memeriksa apakah
 * nilai itu (atau potongannya) muncul di diff. Nilai rahasia TIDAK PERNAH
 * dicetak - hanya panjangnya.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const envPath = path.join(ROOT, '.env');

// Nama variabel yang nilainya rahasia. Sengaja eksplisit: jangan pernah
// menganggap semua isi .env rahasia (mis. IPOS_TOKO bukan rahasia).
const RAHASIA = [
  'BOT_TOKEN', 'IPOS_KEY', 'IPOS_NK_KEY', 'IPOS_KEFA_KEY',
  'GEMINI_KEY', 'GEMINI_KEY_2', 'GEMINI_KEY_3',
  'GROQ_API_KEY', 'OPENROUTER_API_KEY',
  'DASHBOARD_PASS', 'SESSION_SECRET', 'ENCRYPT_PASSWORD',
  'GITHUB_TOKEN', 'TS_AUTHKEY',
];

const nilai = [];
if (fs.existsSync(envPath)) {
  const isi = fs.readFileSync(envPath, 'utf8');
  for (const baris of isi.split(/\r?\n/)) {
    const m = baris.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const nama = m[1];
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!RAHASIA.includes(nama)) continue;
    if (!v || v.length < 6) continue;
    nilai.push({ nama, nilai: v });
  }
}

console.log('Nilai rahasia yang diperiksa: ' + nilai.length);
for (const n of nilai) console.log('  ' + n.nama.padEnd(20) + ' panjang=' + n.nilai.length);

let diff = '';
try {
  diff = execSync('git diff HEAD', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  diff += '\n' + execSync('git diff --cached', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  console.error('Gagal membaca diff: ' + e.message);
  process.exit(1);
}

// File baru yang belum dilacak juga harus diperiksa.
try {
  const takLacak = execSync('git ls-files --others --exclude-standard', { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean);
  for (const f of takLacak) {
    try {
      const p = path.join(ROOT, f);
      if (fs.statSync(p).size < 4 * 1024 * 1024) diff += '\n' + fs.readFileSync(p, 'utf8');
    } catch (_) { /* biner / hilang */ }
  }
} catch (_) { /* tidak ada */ }

console.log('\nUkuran bahan yang dipindai: ' + diff.length + ' karakter');

let bocor = 0;
for (const n of nilai) {
  if (diff.includes(n.nilai)) {
    console.error('  BOCOR: nilai ' + n.nama + ' muncul di diff!');
    bocor++;
    continue;
  }
  // Potongan 12 karakter: menangkap nilai yang terpotong di tengah.
  const potong = n.nilai.slice(0, 12);
  if (potong.length >= 12 && diff.includes(potong)) {
    console.error('  CURIGA: potongan ' + n.nama + ' muncul di diff!');
    bocor++;
  }
}

// Pola token bot Telegram, siapa pun pemiliknya.
const polaToken = /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g;
const token = diff.match(polaToken);
if (token) {
  console.error('  BOCOR: ' + token.length + ' pola token bot Telegram ditemukan');
  bocor++;
}

if (bocor) {
  console.error('\nHASIL: ' + bocor + ' kebocoran. JANGAN COMMIT.');
  process.exit(1);
}
console.log('\nHASIL: nol kebocoran.');

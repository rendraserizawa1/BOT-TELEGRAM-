'use strict';
/**
 * Tes: path tujuan nota harus benar-benar ada di share ADMIN_DIMAS.
 *
 * Kenapa: bug pra-ada (2026-11-14) — path ELT menunjuk share
 * `\\100.125.99.99\TOKO NASIONAL KITCHEN` yang TIDAK ADA (share nyata hanya
 * E, Intel, Users). Akibatnya setiap simpan nota NK selalu gagal, dan
 * kegagalannya tidak kelihatan karena tidak ada fallback saat itu.
 *
 * Tes ini memeriksa dua hal:
 *  1. Bentuk path (share E, bukan share fiktif) — selalu bisa dijalankan.
 *  2. Keberadaan folder sebenarnya — hanya bila share terjangkau.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

let gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) { console.log('  PASS  ' + nama); }
  else { console.error('  GAGAL ' + nama + (detail ? ' -> ' + detail : '')); gagal++; }
}

// Ambil blok notaTokoFolder
const m = src.match(/notaTokoFolder:\s*\{([\s\S]*?)\n  \},/);
if (!m) { console.error('GAGAL: blok notaTokoFolder tidak ditemukan'); process.exit(1); }
const blok = m[1];

const elt = (blok.match(/ELT:\s*\{\s*base:\s*'([^']+)'/) || [])[1] || '';
const kef = (blok.match(/KEF:\s*\{\s*base:\s*'([^']+)'/) || [])[1] || '';

const unescape = (s) => s.replace(/\\\\/g, '\\');
const eltPath = unescape(elt);
const kefPath = unescape(kef);

// 1) Bentuk path: harus lewat share E, dan TIDAK memakai share fiktif
cek('ELT memakai share E', /^\\\\100\.125\.99\.99\\E\\/.test(eltPath), eltPath);
cek('KEF memakai share E', /^\\\\100\.125\.99\.99\\E\\/.test(kefPath), kefPath);
cek('ELT bukan share fiktif "TOKO NASIONAL KITCHEN" langsung',
  !/^\\\\100\.125\.99\.99\\TOKO NASIONAL KITCHEN/i.test(eltPath), eltPath);
cek('KEF bukan E_Drive lama', !/\\E_Drive\\/i.test(kefPath), kefPath);

// 2) Pola bulan harus sesuai nama folder yang benar-benar ada
cek('ELT pakai {bulan} huruf kecil', /\{bulan\}/.test(blok.match(/ELT:[^\n]*/)[0]));
cek('KEF pakai {BULAN} huruf besar', /\{BULAN\}/.test(blok.match(/KEF:[^\n]*/)[0]));

// 3) Keberadaan folder nyata (hanya bila share terjangkau dari sesi ini)
const terjangkau = (() => { try { return fs.existsSync('\\\\100.125.99.99\\E'); } catch { return false; } })();
if (terjangkau) {
  cek('folder ELT ada di share', fs.existsSync(eltPath), eltPath);
  cek('folder KEF ada di share', fs.existsSync(kefPath), kefPath);
  console.log('  (share terjangkau: keberadaan folder diperiksa)');
} else {
  console.log('  (share tidak terjangkau dari sesi ini: hanya bentuk path yang diperiksa)');
}

if (gagal) process.exit(1);
console.log('OK path nota 6/6' + (terjangkau ? ' + 2 cek folder nyata' : ''));

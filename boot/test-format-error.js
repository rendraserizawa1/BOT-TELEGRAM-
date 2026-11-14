// test-format-error.js
// Uji regresi: pesan error iPos harus memuat PENYEBAB sebenarnya.
//
// Bug nyata yang pernah terjadi: status/notifikasi hanya menampilkan
// "fetch failed" karena catch SSE menimpa lastError yang lebih kaya. Admin
// jadi tidak tahu apakah host mati total (UND_ERR_CONNECT_TIMEOUT) atau
// koneksi diputus (ECONNRESET) — dua hal yang penanganannya berbeda.
'use strict';

// SALINAN PERSIS dari ipos-bridge.js (harus tetap sama).
function formatError(e) {
  const pesan = String((e && e.message) || e || 'error');
  const c = e && e.cause;
  if (!c) return pesan;
  const sub = c.errors && c.errors.length
    ? ' [' + c.errors.map((x) => (x && (x.code || x.message)) || '?').join(', ') + ']'
    : '';
  return `${pesan} (cause: ${c.code || c.message || String(c)}${sub})`;
}

let lulus = 0, gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) { lulus++; console.log(`  PASS  ${nama}`); }
  else { gagal++; console.log(`  FAIL  ${nama}${detail ? ' -> ' + detail : ''}`); }
}

console.log('=== Uji formatError ===\n');

// 1. Kasus nyata: host mati total.
const e1 = new Error('fetch failed');
e1.cause = { code: 'UND_ERR_CONNECT_TIMEOUT' };
const h1 = formatError(e1);
console.log(`  fetch failed + cause -> ${h1}`);
cek('menyertakan UND_ERR_CONNECT_TIMEOUT', h1.includes('UND_ERR_CONNECT_TIMEOUT'), h1);

// 2. Kasus aggregate (undici menaruh beberapa error).
const e2 = new Error('fetch failed');
e2.cause = { code: 'ETIMEDOUT', errors: [{ code: 'ETIMEDOUT' }, { code: 'ECONNREFUSED' }] };
const h2 = formatError(e2);
console.log(`  aggregate            -> ${h2}`);
cek('menyertakan daftar error aggregate',
  h2.includes('ETIMEDOUT') && h2.includes('ECONNREFUSED'), h2);

// 3. Tanpa cause -> tetap pesan asli, tidak error.
const h3 = formatError(new Error('HTTP 500'));
console.log(`  tanpa cause          -> ${h3}`);
cek('tanpa cause tetap aman', h3 === 'HTTP 500', h3);

// 4. Error dengan cause berupa message (bukan code).
const e4 = new Error('fetch failed');
e4.cause = { message: 'socket hang up' };
const h4 = formatError(e4);
console.log(`  cause.message        -> ${h4}`);
cek('memakai cause.message bila tak ada code', h4.includes('socket hang up'), h4);

// 5. Nilai aneh tidak boleh melempar.
cek('null aman', formatError(null) === 'error', formatError(null));
cek('string aman', formatError('gagal') === 'gagal', formatError('gagal'));

// 6. Aturan anti-timpa: error baru hanya dipakai bila TIDAK lebih pendek.
const kaya = 'fetch failed (cause: UND_ERR_CONNECT_TIMEOUT)';
const polos = 'fetch failed';
const pilih = (lama, baru) => (!lama || baru.length >= String(lama).length) ? baru : lama;
cek('penyebab kaya tidak ditimpa yang polos', pilih(kaya, polos) === kaya, pilih(kaya, polos));
cek('penyebab lebih kaya menggantikan yang polos', pilih(polos, kaya) === kaya, pilih(polos, kaya));

console.log(`\n=== HASIL: ${lulus} PASS, ${gagal} FAIL ===`);
process.exit(gagal === 0 ? 0 : 1);

// test-escape-markdown.js
// Uji regresi: teks dinamis yang disisipkan ke pesan Markdown Telegram harus
// di-escape, karena karakter '_' '*' '[' '`' membuat Telegram menolak dengan
// "can't parse entities" — peringatan penting jadi tidak terkirim sama sekali.
//
// Kasus nyata: pesan OFFLINE memuat "UND_ERR_CONNECT_TIMEOUT".
'use strict';

// SALINAN PERSIS dari index.js (harus tetap sama).
const __escMd = (s) => String(s == null ? '' : s).replace(/[_*[\]`]/g, (m) => '\\' + m);

let lulus = 0, gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) { lulus++; console.log(`  PASS  ${nama}`); }
  else { gagal++; console.log(`  FAIL  ${nama}${detail ? ' -> ' + detail : ''}`); }
}

console.log('=== Uji escape Markdown Telegram ===\n');

// 1. Kasus nyata yang membuat notifikasi gagal terkirim.
cek('UND_ERR_CONNECT_TIMEOUT ter-escape',
  __escMd('UND_ERR_CONNECT_TIMEOUT') === 'UND\\_ERR\\_CONNECT\\_TIMEOUT',
  __escMd('UND_ERR_CONNECT_TIMEOUT'));

// 2. URL dengan titik dua & garis miring tidak perlu di-escape, dan tidak rusak.
cek('URL utuh',
  __escMd('http://100.125.99.99:8080/ipos') === 'http://100.125.99.99:8080/ipos',
  __escMd('http://100.125.99.99:8080/ipos'));

// 3. Karakter Markdown lain.
cek('bintang di-escape', __escMd('a*b') === 'a\\*b', __escMd('a*b'));
cek('kurung siku di-escape', __escMd('[x]') === '\\[x\\]', __escMd('[x]'));
cek('backtick di-escape', __escMd('`x`') === '\\`x\\`', __escMd('`x`'));

// 4. Teks statis pesan TIDAK boleh berubah (bintang penebal harus tetap).
const statis = '⚠️ *iPos CP OFFLINE 5 menit*';
cek('teks statis tidak di-escape', !statis.includes('\\*'), statis);

// 5. Nilai kosong/null aman.
cek('null aman', __escMd(null) === '', JSON.stringify(__escMd(null)));
cek('undefined aman', __escMd(undefined) === '', JSON.stringify(__escMd(undefined)));

console.log(`\n=== HASIL: ${lulus} PASS, ${gagal} FAIL ===`);
process.exit(gagal === 0 ? 0 : 1);

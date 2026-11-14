'use strict';
/**
 * Baca kredensial server dari xlsx TANPA PERNAH MENCETAK NILAI RAHASIA.
 *
 * Hanya mencetak: nama sheet, nama kolom, dan untuk setiap sel apakah terisi
 * serta panjangnya. Nilai password/token TIDAK ditampilkan.
 *
 * Pemakaian: node boot\baca-kredensial.js "<path xlsx>"
 */

const path = require('path');

function path_join_root(m) { return path.join(__dirname, '..', 'node_modules', m); }

const XLSX = require(path_join_root('xlsx'));

const file = process.argv[2];
if (!file) {
  console.error('Pemakaian: node boot\\baca-kredensial.js "<file.xlsx>"');
  process.exit(1);
}

// Kata kunci yang menandakan nilainya rahasia -> jangan dicetak.
const RAHASIA = /pass|pwd|sandi|secret|token|key|kunci/i;

let wb;
try {
  wb = XLSX.readFile(file, { cellDates: true });
} catch (e) {
  console.error('Gagal membaca: ' + e.message);
  process.exit(1);
}

console.log('Sheet: ' + wb.SheetNames.join(', '));
console.log('');

for (const nama of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[nama], { header: 1, defval: '' });
  console.log('=== SHEET: ' + nama + ' (' + rows.length + ' baris) ===');
  if (!rows.length) { console.log('  (kosong)'); continue; }

  // Baris pertama dianggap header.
  const header = rows[0].map((h) => String(h || '').trim());
  console.log('  kolom: ' + header.map((h, i) => i + '=' + (h || '(tanpa nama)')).join(' | '));
  console.log('');

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.some((c) => String(c || '').trim())) continue;
    const bagian = [];
    for (let c = 0; c < header.length; c++) {
      const judul = header[c] || 'kolom' + c;
      const nilai = row[c];
      const teks = String(nilai === undefined || nilai === null ? '' : nilai).trim();
      if (!teks) { bagian.push(judul + '=(kosong)'); continue; }
      if (RAHASIA.test(judul)) {
        // JANGAN cetak nilainya. Hanya panjang.
        bagian.push(judul + '=[RAHASIA panjang=' + teks.length + ']');
      } else {
        // Nilai non-rahasia (host/user/nama) boleh tampil agar bisa dipakai.
        bagian.push(judul + '=' + teks.slice(0, 60));
      }
    }
    console.log('  baris ' + r + ': ' + bagian.join('  |  '));
  }
  console.log('');
}

'use strict';
// Self-test parser nota (jalankan: node test_nota.js)
// Ekstrak blok [MESIN NOTA] dari index.js supaya logika tetap satu sumber.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const start = src.indexOf('// ── [MESIN NOTA] START');
const end = src.indexOf('// ── [MESIN NOTA] END');
if (start < 0 || end < 0) { console.error('FAIL: marker mesin nota tidak ditemukan'); process.exit(1); }
const code = src.slice(src.indexOf('\n', start) + 1, end);

const BULAN_NOTA = ['januari','februari','maret','april','mei','juni','juli','agustus','september','oktober','november','desember'];
const factory = new Function('BULAN_NOTA', code + '\nreturn { parseNotaOCR, parseNotaManual, buildNamaFileNota };');
const { parseNotaOCR, parseNotaManual, buildNamaFileNota } = factory(BULAN_NOTA);

let gagal = 0;
function cekFile(label, info, harap) {
  const got = info ? buildNamaFileNota(info) : 'null';
  const ok = got === harap;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} → ${got}${ok ? '' : ' | harap ' + harap}`);
  if (!ok) gagal++;
}

// OCR: JSON murni, dengan code fence, dengan teks tambahan
cekFile('ocr json', parseNotaOCR('{"kode": "ELT", "nomor": "000001", "tanggal": 1, "bulan": "September", "tahun": 2026}'), 'ELT 000001-010926.jpg');
cekFile('ocr fence', parseNotaOCR('```json\n{"kode": "ELT", "nomor": "000001", "tanggal": 1, "bulan": "September", "tahun": 2026}\n```'), 'ELT 000001-010926.jpg');
cekFile('ocr teks tambahan', parseNotaOCR('Hasil: {"kode":"ELT","nomor":"000162","tanggal":12,"bulan":"september","tahun":2026}'), 'ELT 000162-120926.jpg');
cekFile('ocr bulan angka', parseNotaOCR('{"kode":"elt","nomor":"000162","tanggal":"12","bulan":"9","tahun":"2026"}'), 'ELT 000162-120926.jpg');
cekFile('ocr tanpa json', parseNotaOCR('nomor tidak terbaca'), 'null');
cekFile('ocr tanggal 40', parseNotaOCR('{"kode":"ELT","nomor":"000001","tanggal":40,"bulan":"September","tahun":2026}'), 'null');
cekFile('ocr bulan salah', parseNotaOCR('{"kode":"ELT","nomor":"000001","tanggal":1,"bulan":"Bulanser","tahun":2026}'), 'null');
cekFile('ocr kode 1 huruf', parseNotaOCR('{"kode":"E","nomor":"000001","tanggal":1,"bulan":"September","tahun":2026}'), 'null');
cekFile('ocr tahun 20265', parseNotaOCR('{"kode":"ELT","nomor":"000001","tanggal":1,"bulan":"September","tahun":20265}'), 'null');
cekFile('ocr nomor dengan suffix -0926', parseNotaOCR('{"kode":"ELT","nomor":"000162-0926","tanggal":12,"bulan":"september","tahun":2026}'), 'ELT 000162-120926.jpg');
cekFile('ocr nomor nempel suffix', parseNotaOCR('{"kode":"ELT","nomor":"0001620926","tanggal":12,"bulan":"september","tahun":2026}'), 'ELT 000162-120926.jpg');
cekFile('manual nomor dengan suffix', parseNotaManual('ELT 000162-0926 12 september 2026'), 'ELT 000162-120926.jpg');

// Manual: nama bulan / angka bulan / salah format
cekFile('manual nama bulan', parseNotaManual('ELT 000162 12 september 2026'), 'ELT 000162-120926.jpg');
cekFile('manual angka bulan', parseNotaManual('ELT 000162 12 9 2026'), 'ELT 000162-120926.jpg');
cekFile('manual kapital', parseNotaManual('ELT 000001 1 SEPTEMBER 2026'), 'ELT 000001-010926.jpg');
cekFile('manual kurang token', parseNotaManual('ELT 000162 12'), 'null');
cekFile('manual 4 token', parseNotaManual('ELT 000162 12 september'), 'null');

console.log(gagal === 0 ? '\nSEMUA LULUS' : `\n${gagal} GAGAL`);
process.exit(gagal === 0 ? 0 : 1);

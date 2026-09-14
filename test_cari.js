'use strict';
// Self-test mesin matching cariBarang (jalankan: node test_cari.js)
// Ekstrak blok [MESIN MATCHING] dari index.js supaya logika tetap satu sumber.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const start = src.indexOf('// ── [MESIN MATCHING] START');
const end = src.indexOf('// ── [MESIN MATCHING] END');
if (start < 0 || end < 0) { console.error('FAIL: marker mesin matching tidak ditemukan'); process.exit(1); }
const code = src.slice(src.indexOf('\n', start) + 1, end);

const CONFIG = { maxHasilCari: 20 };
const DATA_BARANG = [
  { kode: 'NN001', nama: 'DANDANG EAGLE 20 CM', merek: 'EAGLE', jenis: 'PANCI', harga: {} },
  { kode: 'NN002', nama: 'WAJAN 32 CM', merek: 'EAGLE', jenis: 'PANCI', harga: {} },
  { kode: 'NN003', nama: 'TEKO 1.8L STAINLESS', merek: '', jenis: 'TEKO', harga: {} },
  { kode: 'NN004', nama: 'PANCI SUS304 (24 CM)', merek: '', jenis: 'PANCI', harga: {} },
  { kode: 'NN005', nama: 'KASUR BIGFOAM 160', merek: 'BIGFOAM', jenis: 'KASUR', harga: {} },
];

const factory = new Function('CONFIG', 'DATA_BARANG', code + '\nreturn cariBarang;');
const cariBarang = factory(CONFIG, DATA_BARANG);

let gagal = 0;
function cek(query, kodeHarusAda, catatan) {
  const r = cariBarang(query);
  const kodes = r.hasil.map(h => h.kode);
  const ok = kodes.includes(kodeHarusAda);
  console.log(`${ok ? 'OK  ' : 'FAIL'} "${query}" → [${r.tipeHasil}] ${kodes.join(', ') || '-'}${ok ? '' : ' | harap ' + kodeHarusAda + ' (' + catatan + ')'}`);
  if (!ok) gagal++;
}

// kombinasi kata + spasi + tanda khusus + typo + urutan acak + tanpa spasi
cek('dandang eagle 20', 'NN001', 'normal');
cek('eagle dandang 20', 'NN001', 'urutan acak');
cek('dandng eagle 20', 'NN001', 'typo 1 huruf');
cek('dandang-eagle-20', 'NN001', 'tanda hubung');
cek('dandang,eagle 20', 'NN001', 'koma');
cek('dandangeagle20', 'NN001', 'tanpa spasi');
cek('wajan 32', 'NN002', 'normal');
cek('wajan32', 'NN002', 'padat');
cek('wajan-32cm', 'NN002', 'padat + satuan');
cek('teko 1.8l', 'NN003', 'titik desimal');
cek('teko 18l', 'NN003', 'tanpa titik');
cek('panci (24)', 'NN004', 'kurung');
cek('panci sus304 24', 'NN004', 'kode dalam nama');
cek('kasur bigfoam 160', 'NN005', 'normal');

console.log(gagal === 0 ? '\nSEMUA LULUS' : `\n${gagal} GAGAL`);
process.exit(gagal === 0 ? 0 : 1);

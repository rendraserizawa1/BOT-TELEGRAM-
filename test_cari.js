'use strict';
// Self-test mesin matching cariBarang + parser input jenis/qty (jalankan: node test_cari.js)
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

const factory = new Function('CONFIG', 'DATA_BARANG', code + '\nreturn { cariBarang, parseInputJenisQty };');
const { cariBarang, parseInputJenisQty } = factory(CONFIG, DATA_BARANG);

let gagal = 0;
function cek(query, kodeHarusAda, catatan) {
  const r = cariBarang(query);
  const kodes = r.hasil.map(h => h.kode);
  const ok = kodes.includes(kodeHarusAda);
  console.log(`${ok ? 'OK  ' : 'FAIL'} "${query}" → [${r.tipeHasil}] ${kodes.join(', ') || '-'}${ok ? '' : ' | harap ' + kodeHarusAda + ' (' + catatan + ')'}`);
  if (!ok) gagal++;
}

function cekJenis(input, jenisHarap, qtyHarap) {
  const r = parseInputJenisQty(input);
  const ok = jenisHarap === null ? r === null : (r && r.jenis === jenisHarap && r.qty === qtyHarap);
  console.log(`${ok ? 'OK  ' : 'FAIL'} jenis "${input}" → ${r ? `{${r.jenis}, ${r.qty}}` : 'null'}${ok ? '' : ` | harap ${jenisHarap === null ? 'null' : `{${jenisHarap}, ${qtyHarap}}`}`}`);
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

// input qty SO: normal, typo, tanda baca, tanpa spasi, urutan dibalik
cekJenis('toko 15', 'fisik', 15);
cekJenis('tko 15', 'fisik', 15);
cekJenis('toko15', 'fisik', 15);
cekJenis('Toko: 15 pcs', 'fisik', 15);
cekJenis('tokoo 15', 'fisik', 15);
cekJenis('tokooo 15', 'fisik', 15);
cekJenis('tokko 3', 'fisik', 3);
cekJenis('otko 15', 'fisik', 15);
cekJenis('toki 15', 'fisik', 15);
cekJenis('tok 15', 'fisik', 15);
cekJenis('fisik 3', 'fisik', 3);
cekJenis('15 toko', 'fisik', 15);
cekJenis('gudang 20', 'gudang', 20);
cekJenis('gudng 20', 'gudang', 20);
cekJenis('gduang 7', 'gudang', 7);
cekJenis('GUDANG: 20', 'gudang', 20);
cekJenis('gudangg 20', 'gudang', 20);
cekJenis('gudanng 20', 'gudang', 20);
cekJenis('guadng 20', 'gudang', 20);
cekJenis('gudnag 20', 'gudang', 20);
cekJenis('gudaang 20', 'gudang', 20);
cekJenis('guadang 7', 'gudang', 7);
cekJenis('gudag 4', 'gudang', 4);
cekJenis('gdng 6', 'gudang', 6);
cekJenis('gdg 9', 'gudang', 9);
cekJenis('abrakadabra 5', null, null);
cekJenis('toko tanpa angka', null, null);

console.log(gagal === 0 ? '\nSEMUA LULUS' : `\n${gagal} GAGAL`);
process.exit(gagal === 0 ? 0 : 1);

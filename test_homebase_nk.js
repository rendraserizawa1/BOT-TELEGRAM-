'use strict';
// Self-test parser & konversi HOMEBASE NK (jalankan: node test_homebase_nk.js)
// Ekstrak blok NK dari index.js supaya logika tetap satu sumber.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

const s1 = src.indexOf('const VALID_SATUAN_HB');
const e1 = src.indexOf('// Multi-pass NK');
if (s1 < 0 || e1 < 0) { console.error('FAIL: blok parser NK tidak ditemukan'); process.exit(1); }
const block1 = src.slice(s1, e1);

const s2 = src.indexOf('function getFaktorKonversi');
const e2 = src.indexOf('let DB_INDEX_CACHE = null;');
if (s2 < 0 || e2 < 0) { console.error('FAIL: blok konversi tidak ditemukan'); process.exit(1); }
const block2 = src.slice(s2, e2);

const log = { warn() {}, error() {}, info() {} };
const factory = new Function('log', block1 + '\n' + block2 +
  '\nreturn { parseHomebaseScanNk, normNamaSatuanHB, konversiHargaAKePcs, getFaktorKonversi };');
const { parseHomebaseScanNk, normNamaSatuanHB, konversiHargaAKePcs, getFaktorKonversi } = factory(log);

let gagal = 0;
function cek(nama, kondisi) {
  if (kondisi) console.log('  OK  ' + nama);
  else { console.log('  FAIL ' + nama); gagal++; }
}

console.log('== parseHomebaseScanNk ==');
{
  const r = parseHomebaseScanNk('{"jumlahBaris":2,"items":[' +
    '{"nama":"Blender Cosmos CB 282 G Glass","satuan":"pcs","hargaA":350000},' +
    '{"nama":"Eskan Pst Rivera M Putih 2246 P LCS","satuan":"dz","hargaA":168000}]}');
  cek('jumlahBaris=2', r.jumlahBaris === 2);
  cek('2 item', r.items.length === 2);
  cek('hargaA persis', r.items[0].hargaA === 350000 && r.items[1].hargaA === 168000);
  cek('satuan diparse', r.items[0].satuan === 'PCS' && r.items[1].satuan === 'DZ');
}
{
  const r = parseHomebaseScanNk('[{"nama":"TEKO 1.8L","satuan":"pcs","hargaA":"1.200.000"}]');
  cek('fallback array', r.items.length === 1);
  cek('format titik dihapus', r.items[0].hargaA === 1200000);
  cek('jumlahBaris default = jumlah item', r.jumlahBaris === 1);
}
{
  const r = parseHomebaseScanNk('{"jumlahBaris":1,"items":[{"nama":"WAJAN 32 CM","satuan":"pcs","A":75000}]}');
  cek('alias kunci A', r.items[0].hargaA === 75000);
}
{
  const r = parseHomebaseScanNk('{"jumlahBaris":1,"items":[{"nama":"PANCI SUS304","satuan":"pcs","hpp":9000,"hargaB":9500,"hargaD":9900}]}');
  cek('TIDAK fallback ke hpp/B/D (aturan NK)', r.items[0].hargaA === 0);
}
{
  const r = parseHomebaseScanNk('{"jumlahBaris":42,"items":[{"nama":"X1 PANCI BESAR","satuan":"pcs","hargaA":1}]}');
  cek('jumlahBaris bisa > item (laporkan kurang)', r.jumlahBaris === 42 && r.items.length === 1);
}

console.log('== normNamaSatuanHB ==');
{
  const a = normNamaSatuanHB('ESKAN PST RIVERA', 'DY');
  cek('DY -> DZ', a.satuan === 'DZ');
  const b = normNamaSatuanHB('KURSI ROTAN DX', 'DX');
  cek('DX bukan satuan -> gabung nama', b.satuan === 'PCS' && b.nama.includes('DX'));
  const c = normNamaSatuanHB('  --TEKO 1.8L--  ', 'pcs');
  cek('trim & uppercase', c.nama === 'TEKO 1.8L' && c.satuan === 'PCS');
}

console.log('== konversiHargaAKePcs + bulat atas 500 ==');
{
  const a = konversiHargaAKePcs({ satuan: 'DZ', hargaA: 168000 });
  cek('dz: faktor 12', a.faktorKonversi === 12 && a.dikonversi === true);
  cek('dz: 168000/12 = 14000 (genap 500)', a.hargaAPcs === 14000 && a.hargaABulat === 14000);
  const b = konversiHargaAKePcs({ satuan: 'PCS', hargaA: 5000 });
  cek('pcs: tanpa konversi', b.dikonversi === false && b.hargaABulat === 5000);
  const c = konversiHargaAKePcs({ satuan: 'DZ', hargaA: 100 });
  cek('floor 100/12=8, bulat atas jadi 500', c.hargaAPcs === 8 && c.hargaABulat === 500);
  const d = konversiHargaAKePcs({ satuan: 'LSN', hargaA: 120000 });
  cek('lsn = 12', d.faktorKonversi === 12 && d.hargaABulat === 10000);
  const e = konversiHargaAKePcs({ satuan: 'PCS', hargaA: 14100 });
  cek('14100 dibulatkan ke atas = 14500', e.hargaABulat === 14500);
  const f = konversiHargaAKePcs({ satuan: 'PCS', hargaA: 0 });
  cek('0 tetap 0 (bukan 500)', f.hargaABulat === 0);
}

// ── Matching: ekstrak [MESIN MATCHING] + blok match homebase ──
const sA = src.indexOf('// ── [MESIN MATCHING] START');
const eA = src.indexOf('// ── [MESIN MATCHING] END');
const sB = src.indexOf('function normalizeForMatch(str) {');
const eB = src.indexOf('// Reset DB cache');
if (sA < 0 || eA < 0 || sB < 0 || eB < 0) { console.error('FAIL: marker blok matching'); process.exit(1); }
const blockA = src.slice(src.indexOf('\n', sA) + 1, eA);
const blockM = src.slice(sB, eB);
const DB_POOL = [
  { kode: 'NN07014', nama: 'KURSI BAKSO NAPOLLY 3R3 WARNA/KURATSEN 3Y3 WARNA', merek: '', jenis: '', harga: { nk: { hpp: 42000 } } },
  { kode: 'NN07336', nama: 'SEALPACK DONAT ERIKO 3,9 L DM', merek: '', jenis: '', harga: { nk: { hpp: 10000 } } },
  { kode: 'NN00500', nama: 'POT LILY TURBOPLAST 20 PUTIH', merek: '', jenis: '', harga: { nk: { hpp: 15000 } } },
];
const matchFactory = new Function('CONFIG', 'DATA_BARANG', 'log',
  'let DB_INDEX_CACHE = null; let DB_INDEX_TIMESTAMP = 0; let DB_INDEX_NK_CACHE = null; let DB_INDEX_NK_TS = 0;\n' +
  blockA + '\n' + blockM +
  '\nreturn { matchBarangHomebase, extractAllNumbers, extractAllWords };');
const { matchBarangHomebase, extractAllNumbers, extractAllWords } = matchFactory({ maxHasilCari: 20 }, DB_POOL, log);

console.log('== matchBarangHomebase (anti nyasar) ==');
{
  const m = matchBarangHomebase('KURSI BAKSO NAPOLLY 3R3 WARNA/KURATSEN 3Y3 WARNA');
  cek('nama persis = 100% ke item benar', !!m && m.matchScore === 100 && m.item.kode === 'NN07014');
}
{
  // Kasus nyata: donat TIDAK BOLEH nyasar ke KURSI BAKSO NAPOLLY
  const m = matchBarangHomebase('SEAL PACK DONAT 3,3 LT ORI TURBOPLAST');
  cek('donat tidak nyasar ke kursi bakso', !m || m.item.kode !== 'NN07014');
}
{
  const m = matchBarangHomebase('SEALPACK DONAT ERIKO 3,9 L DM');
  cek('nama persis donat = 100% ke item benar', !!m && m.matchScore === 100 && m.item.kode === 'NN07336');
}
{
  const nums = [...extractAllNumbers('SEAL PACK DONAT 3,3 LT')];
  cek('desimal "3,3" dipertahankan', nums.length === 1 && nums[0] === '3,3');
  cek('"3,3" beda dengan "33" dan "3,9"', !extractAllNumbers('33 LT').has('3,3') && !extractAllNumbers('3,9 L').has('3,3'));
  cek('sinonim LT = L', extractAllWords('12 LT').has('L'));
}
{
  // "paling mirip" (floor 5) harus dari keluarga SEALPACK DONAT, bukan barang ngawur
  const m = matchBarangHomebase('SEAL PACK DONAT 3,3 LT ORI TURBOPLAST', null, { floor: 5 });
  cek('paling mirip dari keluarga SEALPACK DONAT', !!m && m.item.nama.includes('SEALPACK DONAT'));
  cek('3,3 TURBOPLAST tetap < 45% (tak dipaksakan match)', !!m && m.matchScore < 45);
}

console.log('== kalibrasi nama ==');
{
  // 2 kata nyasar (ORI BARU) dibuang otomatis -> tetap 100% ke item benar
  const m = matchBarangHomebase('SEALPACK DONAT ERIKO 3,9 L DM KW2 ORI BARU');
  cek('buang kata nyasar -> 100% ke NN07336', !!m && m.matchScore === 100 && m.item.kode === 'NN07336');
}
{
  // kata dipindah posisi + tanda baca (koma, strip)
  const m = matchBarangHomebase('DONAT, SEALPACK-ERIKO 3,9 L DM');
  cek('urutan kata & tanda baca -> 100% ke NN07336', !!m && m.matchScore === 100 && m.item.kode === 'NN07336');
}
{
  // kata ukuran (3,3) TIDAK boleh dibuang kalibrasi -> tetap tak match ukuran lain
  const m = matchBarangHomebase('SEALPACK DONAT ERIKO 3,3 L DM', null, { floor: 5 });
  cek('ukuran 3,3 tidak tertukar dengan 3,9', !m || m.item.kode !== 'NN07336' || m.matchScore < 45);
}

console.log('');
if (gagal) { console.error(`ADA ${gagal} GAGAL`); process.exit(1); }
console.log('SEMUA LULUS');

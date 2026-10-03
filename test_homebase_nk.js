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

console.log('== konversiHargaAKePcs ==');
{
  const a = konversiHargaAKePcs({ satuan: 'DZ', hargaA: 168000 });
  cek('dz: faktor 12', a.faktorKonversi === 12 && a.dikonversi === true);
  cek('dz: 168000/12 = 14000', a.hargaAPcs === 14000);
  const b = konversiHargaAKePcs({ satuan: 'PCS', hargaA: 5000 });
  cek('pcs: tanpa konversi', b.dikonversi === false && b.hargaAPcs === 5000);
  const c = konversiHargaAKePcs({ satuan: 'DZ', hargaA: 100 });
  cek('floor dibulatkan ke bawah (100/12=8)', c.hargaAPcs === 8);
  const d = konversiHargaAKePcs({ satuan: 'LSN', hargaA: 120000 });
  cek('lsn = 12', d.faktorKonversi === 12 && d.hargaAPcs === 10000);
}

console.log('');
if (gagal) { console.error(`ADA ${gagal} GAGAL`); process.exit(1); }
console.log('SEMUA LULUS');

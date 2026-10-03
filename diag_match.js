'use strict';
// Diagnosa matching (jalankan: node diag_match.js [NAMA ATAU QUERY])
// Ekstrak mesin dari index.js + data asli harga_toko/*.xlsx
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

// Blok A: [MESIN MATCHING] (levenshtein, cariBarang, dll)
const sA = src.indexOf('// ── [MESIN MATCHING] START');
const eA = src.indexOf('// ── [MESIN MATCHING] END');
if (sA < 0 || eA < 0) { console.error('FAIL: marker MESIN MATCHING'); process.exit(1); }
const blockA = src.slice(src.indexOf('\n', sA) + 1, eA);

// Blok B: normalizeForMatch .. matchBarangHomebase
const sB = src.indexOf('function normalizeForMatch(str) {');
const eB = src.indexOf('// Reset DB cache');
if (sB < 0 || eB < 0) { console.error('FAIL: marker blok homebase match'); process.exit(1); }
const blockB = src.slice(sB, eB);

// ── Load data asli (sama seperti loadExcelPerToko, ringkas) ──
// Mode --nk: pool = snapshot iPos NK asli (storage/ipos_nk_items.json) = pool produksi
const DATA_BARANG = [];
const asalFile = new Map();
const pakaiNk = process.argv.includes('--nk');
const args = process.argv.slice(2).filter(a => a !== '--nk');
if (pakaiNk && fs.existsSync(path.join(__dirname, 'storage', 'ipos_nk_items.json'))) {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'storage', 'ipos_nk_items.json'), 'utf8'));
  for (const x of d) {
    if (!x || !x.nama) continue;
    const item = {
      kode: String(x.kode || '').trim(), nama: String(x.nama).trim(),
      merek: '', jenis: x.kategori || '',
      harga: { nk: { hpp: Number(x.hpp) || 0 } },
    };
    DATA_BARANG.push(item);
    asalFile.set(item, 'iPosNK');
  }
  console.log(`  iPos NK snapshot: ${DATA_BARANG.length} item (pool produksi)`);
} else {
for (const f of ['cp', 'nk', 'tdm', 'oesapa', 'kefa']) {
  const fp = path.join(__dirname, 'harga_toko', f + '.xlsx');
  if (!fs.existsSync(fp)) continue;
  const wb = xlsx.readFile(fp);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
  let hi = -1, H = [];
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const s = (rows[i] || []).map(c => String(c || '').toLowerCase()).join('|');
    if (s.includes('kode') && s.includes('nama')) { hi = i; H = rows[i].map(x => String(x || '').trim()); break; }
  }
  if (hi < 0) { console.log(`  (skip ${f}: header tak ketemu)`); continue; }
  const findCol = (names) => {
    for (const n of names) { const i = H.findIndex(h => h.toLowerCase() === n.toLowerCase()); if (i >= 0) return i; }
    for (const n of names) { const i = H.findIndex(h => h.toLowerCase().includes(n.toLowerCase())); if (i >= 0) return i; }
    return -1;
  };
  const cKode = findCol(['Kode Item', 'Kode', 'Code']);
  const cNama = findCol(['Nama Item', 'Nama', 'Name', 'Item']);
  const cMerek = findCol(['Merek', 'Merk', 'Brand']);
  const cJenis = findCol(['Jenis', 'Type', 'Category']);
  let n = 0;
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const nama = String(r[cNama] || '').trim();
    if (!nama) continue;
    const item = {
      kode: String(r[cKode] || '').trim(),
      nama,
      merek: cMerek >= 0 ? String(r[cMerek] || '') : '',
      jenis: cJenis >= 0 ? String(r[cJenis] || '') : '',
      harga: { cp: { hpp: 1 }, nk: { hpp: 1 }, tdm: { hpp: 1 }, oesapa: { hpp: 1 }, kefa: { hpp: 1 } },
    };
    DATA_BARANG.push(item);
    asalFile.set(item, f);
    n++;
  }
  console.log(`  ${f}.xlsx: ${n} item`);
}
}

const CONFIG = { maxHasilCari: 20 };
const log = { warn() {}, error() {}, info() {} };
const prelude = 'let DB_INDEX_CACHE = null; let DB_INDEX_TIMESTAMP = 0; let DB_INDEX_NK_CACHE = null; let DB_INDEX_NK_TS = 0;\n';
const factory = new Function('CONFIG', 'DATA_BARANG', 'log', prelude + blockA + '\n' + blockB +
  '\nreturn { cariBarang, matchBarangHomebase, normalizeForMatch, extractDeepSignature };');
const { cariBarang, matchBarangHomebase } = factory(CONFIG, DATA_BARANG, log);

const KATA_KUNCI = ['DONAT', 'SEAL PACK', 'TURBOPLAST', 'KURSI BAKSO', 'NAPOLLY', 'KURATSEN', '3R3', '3Y3'];
console.log('\n== NAMA ASLI DI DATA (kata kunci) ==');
const sudah = new Set();
for (const k of KATA_KUNCI) {
  const kumpul = DATA_BARANG.filter(d => d.nama.toUpperCase().includes(k)).slice(0, 8);
  if (!kumpul.length) { console.log(`  [${k}] : (tidak ada)`); continue; }
  console.log(`  [${k}] :`);
  kumpul.forEach(d => {
    const key = d.nama + '|' + asalFile.get(d);
    if (sudah.has(key)) return;
    sudah.add(key);
    console.log(`     (${asalFile.get(d)}) ${d.nama}`);
  });
}

const queries = args.length ? [args.join(' ')] : [
  'SEAL PACK DONAT 3,3 LT ORI TURBOPLAST',
  'KURSI BAKSO NAPOLLY 3R3 WARNA/KURATSEN 3Y3 WARNA',
];

for (const q of queries) {
  console.log(`\n=========== QUERY: "${q}" ===========`);

  const cari = cariBarang(q);
  console.log(`\n[cariBarang] tipe=${cari.tipeHasil} hasil=${cari.hasil.length} saran=${cari.saran.length} total=${cari.totalDitemukan || 0}`);
  cari.hasil.slice(0, 5).forEach((d, i) => console.log(`   ${i + 1}. (${asalFile.get(d)}) ${d.nama}`));
  cari.saran.slice(0, 3).forEach((d, i) => console.log(`   saran ${i + 1}. (${asalFile.get(d)}) ${d.nama}`));

  const m = matchBarangHomebase(q, null, { floor: 0 });
  console.log(`\n[matchBarangHomebase] ${m ? `match ${m.matchScore}% -> ${m.item.nama}` : 'NULL (tidak ada kandidat >= 15)'}`);
  if (m) {
    m.alternatives.slice(0, 3).forEach((a, i) => console.log(`   alt ${i + 1}. ${a.matchScore}% ${a.item.nama}`));
  }
}
console.log('\nSELESAI');

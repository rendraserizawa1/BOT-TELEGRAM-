// test-so-excel-nyata.js
// Menjalankan generateExcelSOGabungan() SUNGGUHAN dengan ExcelJS tiruan yang
// merekam struktur workbook (nama sheet, kolom, dan baris).
//
// Kenapa tes ini ada:
//   Tes lain hanya mencocokkan teks sumber. Itu tidak membuktikan bahwa kolom
//   Tanggal/Jam benar-benar terisi, atau bahwa sheet "Detail Semua Entri" ikut
//   dibuat. ExcelJS tidak terpasang di mesin pengembangan, jadi dipakai tiruan
//   yang mencatat semua panggilan - cukup untuk memeriksa isi workbook.
'use strict';

const fs = require('fs');
const path = require('path');

const AKAR = path.join(__dirname, '..');
const SUMBER = fs.readFileSync(path.join(AKAR, 'index.js'), 'utf8');

let lulus = 0, gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) { lulus++; console.log(`  PASS  ${nama}`); }
  else { gagal++; console.log(`  FAIL  ${nama}${detail ? ' -> ' + detail : ''}`); }
}

function posisiRegex(s, idx) {
  for (let j = idx - 1; j >= 0; j--) {
    const ch = s[j];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue;
    return '(,=:[!&|?{};+-*%<>~^'.includes(ch);
  }
  return true;
}

function ambilFungsi(nama) {
  const pola = new RegExp(`function\\s+${nama}\\s*\\(`);
  const m = pola.exec(SUMBER);
  if (!m) throw new Error(`fungsi ${nama} tidak ditemukan di index.js`);
  let awalKata = m.index;
  const sebelum = SUMBER.slice(Math.max(0, m.index - 6), m.index);
  if (/async\s$/.test(sebelum)) awalKata = m.index - 6;
  const awal = SUMBER.indexOf('{', m.index);
  if (awal < 0) throw new Error(`badan fungsi ${nama} tidak ditemukan`);
  let dalam = 0;
  let i = awal;
  let mode = null;
  let kelasRegex = false;
  for (; i < SUMBER.length; i++) {
    const c = SUMBER[i];
    const next = SUMBER[i + 1];
    if (mode === null) {
      if (c === '/' && next === '/') { mode = '//'; i++; continue; }
      if (c === '/' && next === '*') { mode = '/*'; i++; continue; }
      if (c === '/' && posisiRegex(SUMBER, i)) { mode = 'regex'; kelasRegex = false; continue; }
      if (c === "'") { mode = "'"; continue; }
      if (c === '"') { mode = '"'; continue; }
      if (c === '`') { mode = '`'; continue; }
      if (c === '{') dalam++;
      else if (c === '}') { dalam--; if (dalam === 0) { i++; break; } }
      continue;
    }
    if (mode === '//') { if (c === '\n') mode = null; continue; }
    if (mode === '/*') { if (c === '*' && next === '/') { mode = null; i++; } continue; }
    if (mode === 'regex') {
      if (c === '\\') { i++; continue; }
      if (c === '[') { kelasRegex = true; continue; }
      if (c === ']') { kelasRegex = false; continue; }
      if (c === '/' && !kelasRegex) { mode = null; }
      continue;
    }
    if (mode === "'" || mode === '"' || mode === '`') {
      if (c === '\\') { i++; continue; }
      if (c === mode) mode = null;
      continue;
    }
  }
  return SUMBER.slice(awalKata, i);
}

const FUNGSI = [
  'msMasukAkal',
  'tanggalKeMs',
  'formatTanggalDariMs',
  'formatJamDariMs',
  'tanggalEntri',
  'jamEntri',
  'hitungTotalSO',
  'escapeMd',
  'namaSheetUnik',
  'getSOGabunganData',
  'getBarangBaruSO',
  'generateExcelSOGabungan',
];

const sumberFungsi = FUNGSI.map(ambilFungsi).join('\n\n');

const KONSTANTA_ANGKA = [...SUMBER.matchAll(/^const\s+([A-Z][A-Z0-9_]*)\s*=\s*([^;\n]+);/gm)]
  .filter((m) => /^[\d\s*+\-/().]+$/.test(m[2].trim()))
  .map((m) => `const ${m[1]} = ${m[2].trim()};`)
  .join('\n');

const MS_24_1025 = Date.parse('2026-11-24T02:25:00Z');
const MS_25_1407 = Date.parse('2026-11-25T06:07:00Z');
const RAK_A = 'rak lantai 1 hommy';

// ── ExcelJS tiruan: merekam nama sheet, kolom, dan baris ──
// Cukup lengkap untuk API yang dipakai generateExcelSOGabungan:
// addWorksheet, columns, addRow, getRow().eachCell, row.getCell, getCell,
// addImage, dan xlsx.writeFile.
function buatExcelJSTiruan(rekaman) {
  class Sel {
    constructor() { this.font = {}; this.fill = {}; this.border = {}; this.alignment = {}; this.numFmt = ''; this.value = null; }
  }
  class Baris {
    constructor(nilai) {
      this.values = Array.isArray(nilai) ? nilai : [];
      this.height = 0;
      this.font = {};
      this.fill = {};
    }
    getCell(n) {
      const c = new Sel();
      c.value = this.values[n - 1];
      return c;
    }
    eachCell(cb) {
      const n = Math.max(this.values.length, 1);
      for (let i = 0; i < n; i++) cb(this.getCell(i + 1), i + 1);
    }
  }
  class Sheet {
    constructor(nama) {
      this.name = nama;
      this.columns = [];
      this._rows = [];
      this._barisTambahan = [];
      this._gambar = [];
    }
    addRow(nilai) {
      const r = new Baris(nilai);
      this._rows.push(r);
      this._barisTambahan.push(nilai);
      return r;
    }
    getRow(n) {
      // getRow() dipakai hanya untuk menyetel gaya header; jangan menambah baris
      // ke daftar data supaya jumlah baris data tetap akurat.
      if (!this._gaya) this._gaya = new Map();
      if (!this._gaya.has(n)) this._gaya.set(n, new Baris([]));
      return this._gaya.get(n);
    }
    getCell(alamat) { return new Sel(); }
    addImage(id, opsi) { this._gambar.push({ id, opsi }); }
    get rows() { return this._barisTambahan; }
  }
  class Workbook {
    constructor() {
      this.sheets = [];
      this._gambar = 0;
      this.xlsx = {
        writeFile: async (p) => { rekaman.berkasDitulis.push(p); },
      };
      rekaman.workbook = this;
    }
    addWorksheet(nama) {
      const s = new Sheet(nama);
      this.sheets.push(s);
      rekaman.sheets.push(nama);
      return s;
    }
    addImage() { return ++this._gambar; }
  }
  return { Workbook };
}

function buatSandbox(rekaman) {
  const so = {
    kefa: {
      tanggal: '24/11/2026',
      sesiMulai: MS_24_1025,
      sesiBerakhir: MS_24_1025 + 7 * 24 * 3600 * 1000,
      sesiAktif: true,
      racks: {
        [RAK_A]: {
          items: {
            NN03673: {
              entries: [
                { userId: '8997270739', namaPetugas: 'Dimas', qty: 12, jenis: 'fisik', jamInput: '10:25', timestamp: MS_24_1025, tanggal: '24/11/2026' },
                { userId: '8997270739', namaPetugas: 'Tri', qty: 4, jenis: 'gudang', jamInput: '14:07', timestamp: MS_25_1407, tanggal: '25/11/2026' },
              ],
            },
            NEW_ABC123: {
              entries: [
                { userId: '8997270739', namaPetugas: 'Irwan', qty: 6, jenis: 'fisik', jamInput: '14:10', timestamp: MS_25_1407, tanggal: '25/11/2026' },
              ],
            },
          },
        },
      },
      usersAktif: {},
      barangBaru: [{ kode: 'NEW_ABC123', nama: 'KURSI BARU', rak: RAK_A, jenis: 'fisik', qty: 6, petugas: 'Irwan' }],
    },
  };

  const DATA_BARANG = [
    { kode: 'NN03673', nama: 'LEMARI PAKAIAN', satuan: 'PCS', harga: { kefa: { stok: 15 } } },
  ];

  const src = `
    const arguments0 = arguments[0];
    const SO_SHARED = arguments0.soShared;
    const DATA_BARANG = arguments0.dataBarang;
    const ExcelJS = arguments0.ExcelJS;
    const GARIS_TEBAL = '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501';
    const GARIS_TIPIS = '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500';
    const getSOShared = (toko) => SO_SHARED[toko];
    const segarkanItemRealtime = async () => {};
    const saveShared = () => {};
    const CONFIG = { paths: { storage: '.' } };
    // path diambil dari luar karena new Function tidak punya require.
    const path = arguments0.pathModul;
    const getTanggalIndonesia = () => '24 November 2026';
    const getTanggalSlash = () => '24/11/2026';
    const getJamSekarang = () => '10:25';
    // Foto tidak dipakai di tes ini.
    const simpanFotoKeBuffer = async () => null;
    ${KONSTANTA_ANGKA}
    ${sumberFungsi}
    return { generateExcelSOGabungan };
  `;
  return new Function(src)({ soShared: so, dataBarang: DATA_BARANG, ExcelJS: buatExcelJSTiruan(rekaman), pathModul: path });
}

console.log('=== Uji Stock Opname: Excel dijalankan sungguhan ===\n');

const rekaman = { sheets: [], berkasDitulis: [] };

(async () => {
  let hasil = null;
  let error = null;
  const F = buatSandbox(rekaman);
  try {
    hasil = await F.generateExcelSOGabungan('kefa', 'TOKO KEFA');
  } catch (e) {
    error = e;
  }

  cek('1. Excel berhasil dibuat tanpa error', error === null,
    error ? `${error.name}: ${error.message}` : '');
  cek('1b. berkas xlsx ditulis', rekaman.berkasDitulis.length === 1,
    JSON.stringify(rekaman.berkasDitulis));
  cek('1c. fungsi mengembalikan path berkas', typeof hasil === 'string' && /\.xlsx$/.test(hasil), String(hasil));

  // Workbook diambil dari rekaman tiruan ExcelJS.
  const wb = rekaman.workbook;
  if (!wb || !Array.isArray(wb.sheets)) {
    console.log('\n(workbook kosong - sisa pemeriksaan dilewati)');
    console.log(`\nLULUS: ${lulus}   GAGAL: ${gagal}`);
    process.exit(gagal === 0 ? 0 : 1);
  }

  const namaSheet = wb.sheets.map((s) => s.name);
  cek('2. sheet "Detail Semua Entri" dibuat', namaSheet.some((n) => /Detail Semua Entri/i.test(n)),
    namaSheet.join(' | '));
  cek('2b. tidak ada nama sheet ganda', new Set(namaSheet.map((n) => n.toLowerCase())).size === namaSheet.length,
    namaSheet.join(' | '));
  cek('2c. semua nama sheet <= 31 karakter', namaSheet.every((n) => n.length <= 31),
    namaSheet.filter((n) => n.length > 31).join(', '));

  // ── Sheet per rak: kolom Tanggal + Jam ada dan berurutan ──
  const sheetRak = wb.sheets.find((s) => Array.isArray(s.columns) && s.columns.some((c) => c && c.header === 'Tanggal'));
  cek('3. ada sheet per rak dengan kolom Tanggal', !!sheetRak,
    namaSheet.join(' | '));
  if (sheetRak) {
    const header = sheetRak.columns.map((c) => (c ? c.header : ''));
    cek('3b. kolom Jam ada tepat setelah Tanggal',
      header.indexOf('Jam') === header.indexOf('Tanggal') + 1, header.join(' | '));
    cek('3c. kolom Petugas tetap ada', header.includes('Petugas'), header.join(' | '));
    cek('3d. kolom Qty tetap ada', header.includes('Qty'), header.join(' | '));
    cek('3e. kolom Status tetap ada', header.includes('Status'), header.join(' | '));

    // Baris data: cari baris yang memuat nama petugas.
    const semuaNilai = sheetRak.rows.flat();
    cek('3f. tanggal entri terisi di baris data',
      semuaNilai.includes('24/11/2026') && semuaNilai.includes('25/11/2026'),
      JSON.stringify(semuaNilai.filter((v) => typeof v === 'string' && /\d{2}\/\d{2}\/\d{4}/.test(v))));
    cek('3g. jam entri terisi di baris data',
      semuaNilai.includes('10:25') && semuaNilai.includes('14:07'),
      JSON.stringify(semuaNilai.filter((v) => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v))));
    cek('3h. tidak ada jam kotor "(updated)"',
      !semuaNilai.some((v) => typeof v === 'string' && /\((updated|edited)\)/i.test(v)));
  }

  // ── Sheet Detail Semua Entri: isinya lengkap ──
  const sheetDetail = wb.sheets.find((s) => /Detail Semua Entri/i.test(s.name));
  if (sheetDetail) {
    const header = sheetDetail.columns.map((c) => (c ? c.header : ''));
    cek('4. kolom Detail lengkap',
      ['Tanggal', 'Jam', 'Petugas', 'Rak', 'Jenis', 'Kode', 'Nama Barang', 'Qty'].every((h) => header.includes(h)),
      header.join(' | '));
    const nilai = sheetDetail.rows.flat();
    cek('4b. nama semua petugas tampil', ['Dimas', 'Tri', 'Irwan'].every((n) => nilai.includes(n)),
      ['Dimas', 'Tri', 'Irwan'].filter((n) => !nilai.includes(n)).join(',') + ' tidak ada');
    cek('4c. rak tampil', nilai.includes(RAK_A));
    cek('4d. jenis FISIK & GUDANG dibedakan',
      nilai.includes('FISIK (TOKO)') && nilai.includes('GUDANG'),
      JSON.stringify(nilai.filter((v) => typeof v === 'string' && /FISIK|GUDANG/.test(v))));
    cek('4e. qty per entri tersimpan terpisah',
      nilai.includes(12) && nilai.includes(4) && nilai.includes(6),
      JSON.stringify(nilai.filter((v) => typeof v === 'number')));
    cek('4f. nama barang baru ikut', nilai.includes('KURSI BARU'), 'barang baru tidak ada');
    cek('4g. satu baris per entri (3 baris data)', sheetDetail.rows.length === 3,
      `${sheetDetail.rows.length} baris`);
  }

  console.log('');
  console.log(`LULUS: ${lulus}   GAGAL: ${gagal}`);
  process.exit(gagal === 0 ? 0 : 1);
})();

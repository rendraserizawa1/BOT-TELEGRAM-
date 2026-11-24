// test-so-laporan-nyata.js
// Menjalankan generateLaporanSOGabungan() dan generateExcelSOGabungan() SUNGGUHAN
// di atas data tiruan, lalu memeriksa isi keluarannya.
//
// Kenapa tes ini ada:
//   Tes lain hanya mencocokkan teks sumber (/DETAIL PER ENTRI/i dsb). Cara itu
//   TIDAK menangkap ReferenceError. Contoh nyata yang pernah lolos: laporan
//   memakai `petaBarangBaru` yang hanya dideklarasikan di fungsi Excel, sehingga
//   begitu ada barang baru laporan langsung gagal terkirim tanpa terdeteksi tes.
//
// Tes ini mengeksekusi fungsinya, jadi kesalahan seperti itu langsung terlihat.
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
  // Fungsi bisa `async function` — kata kunci async HARUS ikut terambil, kalau
  // tidak `await` di dalamnya jadi syntax error saat dijalankan di sandbox.
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
  'tandaiHitungUlangSO',
  'escapeMd',
  'getSOGabunganData',
  'getBarangBaruSO',
  'generateLaporanSOGabungan',
];

const sumberFungsi = FUNGSI.map(ambilFungsi).join('\n\n');

const KONSTANTA_ANGKA = [...SUMBER.matchAll(/^const\s+([A-Z][A-Z0-9_]*)\s*=\s*([^;\n]+);/gm)]
  .filter((m) => /^[\d\s*+\-/().]+$/.test(m[2].trim()))
  .map((m) => `const ${m[1]} = ${m[2].trim()};`)
  .join('\n');

// 24 Nov 2026 10:25 WITA
const MS_24_1025 = Date.parse('2026-11-24T02:25:00Z');
// 25 Nov 2026 14:07 WITA
const MS_25_1407 = Date.parse('2026-11-25T06:07:00Z');

const RAK_A = 'rak lantai 1 hommy';

function buatSandbox() {
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
    const GARIS_TEBAL = '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501';
    const GARIS_TIPIS = '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500';
    const getSOShared = (toko) => SO_SHARED[toko];
    const segarkanItemRealtime = async () => {};
    const saveShared = () => {};
    ${KONSTANTA_ANGKA}
    ${sumberFungsi}
    return { generateLaporanSOGabungan, getSOGabunganData };
  `;
  return new Function(src)({ soShared: so, dataBarang: DATA_BARANG });
}

console.log('=== Uji Stock Opname: laporan dijalankan sungguhan ===\n');

let laporan = '';
let error = null;
(async () => {
  const F = buatSandbox();
  try {
    laporan = await F.generateLaporanSOGabungan('kefa', 'TOKO KEFA');
  } catch (e) {
    error = e;
  }

  // ── 1. Laporan tidak error (ini yang menangkap ReferenceError petaBarangBaru) ──
  cek('1. laporan berhasil dibuat tanpa error', error === null,
    error ? `${error.name}: ${error.message}` : '');
  cek('1b. laporan tidak kosong', typeof laporan === 'string' && laporan.length > 100,
    `panjang ${laporan ? laporan.length : 0}`);

  if (!laporan) {
    console.log('\n(laporan kosong - sisa pemeriksaan dilewati)');
    console.log(`\nLULUS: ${lulus}   GAGAL: ${gagal}`);
    process.exit(gagal === 0 ? 0 : 1);
  }

  // ── 2. Header memakai RENTANG sesi, bukan satu tanggal ──
  cek('2. header memuat tanggal mulai sesi', laporan.includes('24/11/2026'), laporan.slice(0, 300));
  cek('2b. header memuat tanggal berakhir sesi', laporan.includes('01/12/2026'), laporan.slice(0, 300));
  cek('2c. header memakai pemisah rentang', /24\/11\/2026\s*[–-]\s*01\/12\/2026/.test(laporan),
    laporan.slice(0, 300));

  // ── 3. Bagian DETAIL PER ENTRI ada dan lengkap ──
  cek('3. ada bagian DETAIL PER ENTRI', /DETAIL PER ENTRI/.test(laporan));
  cek('3b. nama semua petugas tampil', ['Dimas', 'Tri', 'Irwan'].every((n) => laporan.includes(n)),
    ['Dimas', 'Tri', 'Irwan'].filter((n) => !laporan.includes(n)).join(',') + ' tidak ada');
  cek('3c. tanggal tiap entri tampil', laporan.includes('24/11/2026') && laporan.includes('25/11/2026'));
  cek('3d. jam tiap entri tampil', laporan.includes('10:25') && laporan.includes('14:07'));
  cek('3e. rak tampil', laporan.includes(RAK_A));
  cek('3f. jenis FISIK dan GUDANG dibedakan',
    /FISIK \(TOKO\)/.test(laporan) && /GUDANG/.test(laporan));
  cek('3g. qty per entri tampil', /\*12\*/.test(laporan) && /\*4\*/.test(laporan) && /\*6\*/.test(laporan));
  cek('3h. nama barang baru ikut tampil', laporan.includes('KURSI BARU'), 'barang baru tidak tampil');
  cek('3i. jumlah entri disebut', /3 entri/.test(laporan), 'ringkasan entri tidak ada');

  // ── 4. Ringkasan tetap ada ──
  cek('4. bagian RINGKASAN tetap ada', /RINGKASAN/.test(laporan));

  // ── 5. Tidak ada teks rusak di keluaran ──
  cek('5. tidak ada "undefined" di laporan', !/undefined/.test(laporan),
    (laporan.match(/.{0,40}undefined.{0,40}/) || [''])[0]);
  cek('5b. tidak ada "NaN" di laporan', !/NaN/.test(laporan),
    (laporan.match(/.{0,40}NaN.{0,40}/) || [''])[0]);
  cek('5c. tidak ada "[object Object]" di laporan', !/\[object Object\]/.test(laporan));

  // ── 6. Total memakai aturan hitungTotalSO (hari terakhir menang) ──
  // NN03673: fisik 12 (24/11) + gudang 4 (25/11) -> fisik 12, gudang 4.
  const gab = buatSandbox().getSOGabunganData('kefa');
  cek('6. gabungan fisik NN03673 = 12', gab.fisik.NN03673 === 12, JSON.stringify(gab.fisik));
  cek('6b. gabungan gudang NN03673 = 4', gab.gudang.NN03673 === 4, JSON.stringify(gab.gudang));

  // ── 7. Laporan tetap satu pesan utuh (kirim() yang memecah) ──
  cek('7. laporan mengembalikan satu string utuh', typeof laporan === 'string');

  console.log('');
  console.log(`LULUS: ${lulus}   GAGAL: ${gagal}`);
  process.exit(gagal === 0 ? 0 : 1);
})();

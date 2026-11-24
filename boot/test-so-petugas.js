// test-so-petugas.js
// Uji regresi Stock Opname: nama petugas + jam harus tampil pada barang yang
// sudah dihitung ORANG LAIN, walaupun akun Telegram-nya sama.
//
// Kenapa tes ini ada (bug produksi 24 Nov 2026):
//   Satu HP toko dipakai bergantian dengan SATU akun Telegram. Data produksi:
//   114 entri SO hanya punya 1 userId (8997270739) tetapi memuat 2 nama petugas
//   ("ibu fitri dan intan", "MAS ANDRI"). Kode lama membandingkan userId,
//   sehingga barang yang dihitung orang lain di rak yang sama dianggap
//   "milik sendiri" -> blok "BARANG INI SUDAH ADA DI" tidak pernah muncul.
//   Bug kedua: tambahQtyItemSO mencocokkan entri hanya dengan userId+jenis,
//   tanpa namaPetugas, sehingga qty petugas baru digabung ke entri petugas lama
//   (jejaknya: 6 entri bertanda "(updated)"/"(edited)").
//
// Tes ini TIDAK menyalin fungsi. Ia membaca index.js, mengambil fungsi yang
// sebenarnya, dan menjalankannya dengan dependensi tiruan. Jadi kalau kode
// berubah, tes ikut menguji kode yang baru.
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

// ─── Ambil fungsi asli dari index.js lewat pencocokan kurung kurawal ──────
// Perlu pengenal literal regex: escapeMd() memuat /[...`...]/ yang berisi
// backtick di dalam character class. Tanpa ini, pemindai salah masuk mode
// template dan badan fungsi terpotong.
function posisiRegex(s, idx) {
  // Lihat karakter bermakna terakhir sebelum '/'.
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
  // Mulai dari '{' pertama setelah tanda tangan fungsi.
  const awal = SUMBER.indexOf('{', m.index);
  if (awal < 0) throw new Error(`badan fungsi ${nama} tidak ditemukan`);
  let dalam = 0;
  let i = awal;
  let mode = null; // null | "'" | '"' | '`' | '//' | '/*' | 'regex'
  let kelasRegex = false; // sedang di dalam [...] sebuah regex
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
  return SUMBER.slice(m.index, i);
}

const FUNGSI = [
  'kunciPetugas',
  'getBarangDiSemuaRak',
  'getTotalBarangSemuaRak',
  'formatInfoBarangDiRakLain',
  'tambahInputSO',
  'tambahQtyItemSO',
  'tampilkanBarangPilihan',
  'escapeMd',
];

const sumberFungsi = FUNGSI.map(ambilFungsi).join('\n\n');

// Bangun dunia tiruan yang meniru bentuk data produksi.
function buatDunia() {
  return {
    kefa: {
      tanggal: '24/11/2026',
      sesiAktif: true,
      racks: {
        'rak kaca lantai 1 toko': {
          items: {
            NN09296: {
              entries: [
                // KASUS NYATA: akun Telegram SAMA, orang BEDA.
                { userId: '8997270739', namaPetugas: 'ibu fitri dan intan', qty: 7, jenis: 'fisik', jamInput: '11:22', timestamp: 1 },
              ],
            },
            NN02099: {
              entries: [
                // Jejak penggabungan model lama.
                { userId: '8997270739', namaPetugas: 'ibu fitri dan intan', qty: 33, jenis: 'fisik', jamInput: '13:30 (updated)', timestamp: 2 },
              ],
            },
            NN07777: {
              entries: [
                // Nama beda kapitalisasi — harus dianggap orang yang sama.
                { userId: '8997270739', namaPetugas: 'Ibu fitri dan intan', qty: 4, jenis: 'fisik', jamInput: '14:00', timestamp: 3 },
              ],
            },
          },
        },
        'gudang lantai 1 bawah': {
          items: {
            NN11881: {
              entries: [
                { userId: '8997270739', namaPetugas: 'MAS ANDRI', qty: 1, jenis: 'fisik', jamInput: '11:20', timestamp: 4 },
              ],
            },
          },
        },
      },
      usersAktif: {},
      barangBaru: [],
    },
  };
}

const SO = buatDunia();
// getSOShared asli dipanggil oleh fungsi; suntikkan versi tiruan lewat new Function.
// escapeMd TIDAK di-stub: tes memakai escapeMd asli dari index.js.
function buatSandbox(so) {
  const src = `
    const SO = arguments[0];
    const getSOShared = (toko) => SO[toko];
    const GARIS_TEBAL = '━━━━━━━━━━━━━━━━━━━━';
    const getJamSekarang = () => '10:00';
    const saveShared = () => {};
    ${sumberFungsi}
    return { ${FUNGSI.join(', ')} };
  `;
  return new Function(src)(so);
}
const F2 = buatSandbox(SO);

console.log('=== Uji Stock Opname: petugas + jam pada barang yang sudah dihitung ===\n');

// ── 1. Petugas BEDA, akun SAMA, rak SAMA -> blok HARUS muncul ─────────────
const hasil1 = F2.formatInfoBarangDiRakLain('kefa', 'NN09296', 'rak kaca lantai 1 toko', '8997270739', 'MAS ANDRI');
cek('1. petugas beda + akun sama + rak sama -> blok muncul', hasil1 !== '' && hasil1.includes('ibu fitri dan intan'), hasil1 || '(kosong)');
cek('1b. nama petugas tampil', hasil1.includes('ibu fitri dan intan'));
cek('1c. jam hitung tampil', hasil1.includes('11:22'));
cek('1d. rak tampil', hasil1.includes('rak kaca lantai 1 toko'));
cek('1e. qty tampil', hasil1.includes('7'));

// ── 2. Petugas SAMA, rak SAMA -> blok TIDAK muncul ───────────────────────
const hasil2 = F2.formatInfoBarangDiRakLain('kefa', 'NN09296', 'rak kaca lantai 1 toko', '8997270739', 'ibu fitri dan intan');
cek('2. petugas sama + rak sama -> blok kosong', hasil2 === '', hasil2);

// ── 3. Rak BEDA -> blok muncul ───────────────────────────────────────────
const hasil3 = F2.formatInfoBarangDiRakLain('kefa', 'NN11881', 'rak kaca lantai 1 toko', '8997270739', 'MAS ANDRI');
cek('3. rak beda -> blok muncul', hasil3 !== '' && hasil3.includes('gudang lantai 1 bawah'), hasil3 || '(kosong)');

// ── 4. Nama beda kapitalisasi = orang yang sama ──────────────────────────
const hasil4 = F2.formatInfoBarangDiRakLain('kefa', 'NN07777', 'rak kaca lantai 1 toko', '8997270739', 'ibu fitri dan intan');
cek('4. beda kapitalisasi dianggap orang sama -> blok kosong', hasil4 === '', hasil4);
const hasil4b = F2.formatInfoBarangDiRakLain('kefa', 'NN07777', 'rak kaca lantai 1 toko', '8997270739', 'MAS ANDRI');
cek('4b. orang lain tetap melihatnya', hasil4b.includes('Ibu fitri dan intan'), hasil4b || '(kosong)');

// ── 5. Qty petugas A lalu B -> DUA entri terpisah ────────────────────────
F2.tambahQtyItemSO('kefa', 'rak kaca lantai 1 toko', 'NN09296', '8997270739', 'MAS ANDRI', 5, 'fisik');
const entri5 = SO.kefa.racks['rak kaca lantai 1 toko'].items.NN09296.entries;
cek('5. petugas beda -> entri terpisah', entri5.length === 2, `jumlah entri=${entri5.length}`);
cek('5b. nama petugas baru tersimpan benar', entri5.some((e) => e.namaPetugas === 'MAS ANDRI' && e.qty === 5), JSON.stringify(entri5.map((e) => [e.namaPetugas, e.qty])));
cek('5c. entri petugas lama TIDAK ikut bertambah', entri5.some((e) => e.namaPetugas === 'ibu fitri dan intan' && e.qty === 7), JSON.stringify(entri5.map((e) => [e.namaPetugas, e.qty])));

// ── 6. Petugas SAMA menambah lagi -> tetap SATU entri, qty bertambah ─────
F2.tambahQtyItemSO('kefa', 'rak kaca lantai 1 toko', 'NN09296', '8997270739', 'MAS ANDRI', 3, 'fisik');
const entri6 = SO.kefa.racks['rak kaca lantai 1 toko'].items.NN09296.entries;
cek('6. petugas sama menambah -> tetap 2 entri', entri6.length === 2, `jumlah=${entri6.length}`);
cek('6b. qty petugas itu bertambah jadi 8', entri6.some((e) => e.namaPetugas === 'MAS ANDRI' && e.qty === 8), JSON.stringify(entri6.map((e) => [e.namaPetugas, e.qty])));

// ── 6c. Kapitalisasi berbeda tetap digabung ke orang yang sama ───────────
F2.tambahQtyItemSO('kefa', 'rak kaca lantai 1 toko', 'NN07777', '8997270739', 'IBU FITRI DAN INTAN', 2, 'fisik');
const entri6c = SO.kefa.racks['rak kaca lantai 1 toko'].items.NN07777.entries;
cek('6c. beda kapitalisasi -> digabung, bukan entri baru', entri6c.length === 1, `jumlah=${entri6c.length}`);
cek('6d. qty jadi 6', entri6c[0].qty === 6, String(entri6c[0].qty));

// ── 7. Entri "(updated)" diberi peringatan data lama ─────────────────────
const hasil7 = F2.formatInfoBarangDiRakLain('kefa', 'NN02099', 'rak kaca lantai 1 toko', '8997270739', 'MAS ANDRI');
cek('7. entri bertanda -> ada peringatan data lama', /data lama/i.test(hasil7), hasil7 || '(kosong)');
cek('7b. peringatan menyebut petugas bisa tercampur', /tercampur/i.test(hasil7));
const hasil7b = F2.formatInfoBarangDiRakLain('kefa', 'NN09296', 'rak kaca lantai 1 toko', '8997270739', 'MAS ANDRI');
cek('7c. entri normal TIDAK diberi peringatan', !/data lama/i.test(hasil7b), hasil7b);

// ── 8. Tidak ada data lain -> string kosong (regresi) ────────────────────
const hasil8 = F2.formatInfoBarangDiRakLain('kefa', 'TIDAK_ADA', 'rak kaca lantai 1 toko', '8997270739', 'MAS ANDRI');
cek('8. barang tanpa data lain -> kosong', hasil8 === '', hasil8);

// ── 9. Nama petugas kosong tidak crash ───────────────────────────────────
let aman = true;
try {
  F2.formatInfoBarangDiRakLain('kefa', 'NN09296', 'rak kaca lantai 1 toko', '8997270739', null);
  F2.formatInfoBarangDiRakLain('kefa', 'NN09296', 'rak kaca lantai 1 toko', '8997270739', undefined);
  F2.formatInfoBarangDiRakLain('kefa', 'NN09296', 'rak kaca lantai 1 toko', '8997270739', '');
} catch (e) { aman = false; console.log('     error: ' + e.message); }
cek('9. nama petugas null/undefined/kosong tidak crash', aman);
cek('9b. kunciPetugas aman untuk null', F2.kunciPetugas(null) === '' && F2.kunciPetugas(undefined) === '');

// ── 10. Layar penuh: blok muncul di "Barang ditemukan!" ──────────────────
const layar = F2.tampilkanBarangPilihan(
  { kode: 'NN09296', nama: 'PIRING BT PAUS BIRU', satuan: 'PCS', harga: { kefa: { stok: 120 } } },
  'kefa', '8997270739', 'rak kaca lantai 1 toko', 'MAS ANDRI'
);
cek('10. layar "Barang ditemukan!" memuat blok petugas', layar.includes('BARANG INI SUDAH ADA DI'), layar);
cek('10b. layar memuat nama petugas + jam', layar.includes('ibu fitri dan intan') && layar.includes('11:22'));
cek('10c. layar tetap memuat stok sistem', layar.includes('Stok Sistem: 120'));

// ── 11. Kebalikan: petugas yang sama tidak melihat blok di layar ─────────
// Pakai dunia BERSIH: tes 5/6 di atas sudah menambah entri MAS ANDRI ke
// NN09296, jadi kalau memakai SO yang sama, ibu fitri memang seharusnya
// melihat entri MAS ANDRI. Untuk menguji "tidak ada blok", butuh data bersih.
const SObersih = buatDunia();
const F3 = buatSandbox(SObersih);
const layar2 = F3.tampilkanBarangPilihan(
  { kode: 'NN09296', nama: 'PIRING BT PAUS BIRU', satuan: 'PCS', harga: { kefa: { stok: 120 } } },
  'kefa', '8997270739', 'rak kaca lantai 1 toko', 'ibu fitri dan intan'
);
cek('11. petugas sama -> layar tanpa blok "sudah ada di"', !layar2.includes('BARANG INI SUDAH ADA DI'), layar2);

// ── 12. Nama petugas berkarakter Markdown tidak boleh merusak pesan ──────
// Pesan dikirim dengan parse_mode 'Markdown'. Nama seperti "Budi_Santoso" atau
// "A*B" membuat Telegram menolak seluruh pesan bila tidak di-escape.
const SOmd = buatDunia();
SOmd.kefa.racks['rak kaca lantai 1 toko'].items.NN55555 = {
  entries: [
    { userId: '8997270739', namaPetugas: 'Budi_Santoso', qty: 2, jenis: 'fisik', jamInput: '09:15', timestamp: 5 },
  ],
};
const F4 = buatSandbox(SOmd);
const hasilMd = F4.formatInfoBarangDiRakLain('kefa', 'NN55555', 'rak kaca lantai 1 toko', '8997270739', 'MAS ANDRI');
cek('12. nama ber-underscore di-escape', hasilMd.includes('Budi\\_Santoso'), hasilMd);
// Setelah semua '*' pembungkus dihapus, jumlah '*' harus genap (tidak ada bold menggantung).
const bintang = (hasilMd.match(/\*/g) || []).length;
cek('12b. penanda bold seimbang', bintang % 2 === 0, `jumlah * = ${bintang}`);
// Karakter '_' yang tidak di-escape akan membuat italic menggantung.
const garisBawah = (hasilMd.match(/(?<!\\)_/g) || []).length;
cek('12c. tidak ada underscore liar', garisBawah === 0, `underscore tak ter-escape = ${garisBawah}`);

// ── 13. jenis kosong/aneh tidak crash ────────────────────────────────────
const SOjenis = buatDunia();
SOjenis.kefa.racks['rak kaca lantai 1 toko'].items.NN66666 = {
  entries: [{ userId: '8997270739', namaPetugas: 'Petugas X', qty: 1, jamInput: '08:00', timestamp: 6 }],
};
const F5 = buatSandbox(SOjenis);
let amanJenis = true;
let hasilJenis = '';
try {
  hasilJenis = F5.formatInfoBarangDiRakLain('kefa', 'NN66666', 'rak kaca lantai 1 toko', '8997270739', 'MAS ANDRI');
} catch (e) { amanJenis = false; console.log('     error: ' + e.message); }
cek('13. entri tanpa jenis tidak crash', amanJenis);
cek('13b. entri tanpa jenis tetap tampil', amanJenis && hasilJenis.includes('Petugas X'), hasilJenis);

console.log('');
console.log('────────────────────────────────────────────');
console.log(`  LULUS: ${lulus}   GAGAL: ${gagal}`);
console.log('────────────────────────────────────────────');
process.exit(gagal === 0 ? 0 : 1);

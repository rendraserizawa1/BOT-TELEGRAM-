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
  'samakanNamaPetugas',
  'getDaftarPetugasSO',
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
    const STOCKOPNAME = SO.__stockopname || {};
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

// ── 2. Petugas SAMA, rak SAMA -> blok TETAP muncul, ditandai "(Anda)" ────
// Dulu blok disembunyikan bila petugasnya sendiri, sehingga layar
// "Barang ditemukan!" tidak memuat nama petugas + jam sama sekali.
// Sekarang riwayat SELALU ditampilkan; entri milik sendiri diberi tanda.
const hasil2 = F2.formatInfoBarangDiRakLain('kefa', 'NN09296', 'rak kaca lantai 1 toko', '8997270739', 'ibu fitri dan intan');
cek('2. petugas sama + rak sama -> blok TETAP muncul', hasil2 !== '', '(kosong)');
cek('2b. entri milik sendiri ditandai (Anda)', /\(Anda\)/i.test(hasil2), hasil2);
cek('2c. nama petugas tetap tampil', hasil2.includes('ibu fitri dan intan'), hasil2);
cek('2d. jam hitung tetap tampil', hasil2.includes('11:22'), hasil2);
cek('2e. qty tetap tampil', /7/.test(hasil2), hasil2);

// ── 3. Rak BEDA -> blok muncul ───────────────────────────────────────────
const hasil3 = F2.formatInfoBarangDiRakLain('kefa', 'NN11881', 'rak kaca lantai 1 toko', '8997270739', 'MAS ANDRI');
cek('3. rak beda -> blok muncul', hasil3 !== '' && hasil3.includes('gudang lantai 1 bawah'), hasil3 || '(kosong)');

// ── 4. Nama beda kapitalisasi = orang yang sama ──────────────────────────
const hasil4 = F2.formatInfoBarangDiRakLain('kefa', 'NN07777', 'rak kaca lantai 1 toko', '8997270739', 'ibu fitri dan intan');
cek('4. beda kapitalisasi dianggap orang sama -> ditandai (Anda)', /\(Anda\)/i.test(hasil4), hasil4 || '(kosong)');
const hasil4b = F2.formatInfoBarangDiRakLain('kefa', 'NN07777', 'rak kaca lantai 1 toko', '8997270739', 'MAS ANDRI');
cek('4b. orang lain TIDAK ditandai (Anda)', !/\(Anda\)/i.test(hasil4b), hasil4b || '(kosong)');
cek('4c. orang lain tetap melihat nama pemiliknya', hasil4b.includes('Ibu fitri dan intan'), hasil4b);

// ── 5. Qty petugas A lalu B -> DUA entri terpisah ────────────────────────
F2.tambahQtyItemSO('kefa', 'rak kaca lantai 1 toko', 'NN09296', '8997270739', 'MAS ANDRI', 5, 'fisik');
const entri5 = SO.kefa.racks['rak kaca lantai 1 toko'].items.NN09296.entries;
cek('5. petugas beda -> entri terpisah', entri5.length === 2, `jumlah entri=${entri5.length}`);
cek('5b. nama petugas baru tersimpan benar', entri5.some((e) => e.namaPetugas === 'MAS ANDRI' && e.qty === 5), JSON.stringify(entri5.map((e) => [e.namaPetugas, e.qty])));
cek('5c. entri petugas lama TIDAK ikut bertambah', entri5.some((e) => e.namaPetugas === 'ibu fitri dan intan' && e.qty === 7), JSON.stringify(entri5.map((e) => [e.namaPetugas, e.qty])));

// ── 6. Petugas SAMA input lagi -> entri BARU, bukan digabung ─────────────
// Permintaan pemilik: tiap input harus tampil terpisah per entry per qty,
// dengan jam:menit masing-masing. Dulu qty digabung jadi satu entri dan jam
// lamanya hilang (ditimpa "... (updated)").
F2.tambahQtyItemSO('kefa', 'rak kaca lantai 1 toko', 'NN09296', '8997270739', 'MAS ANDRI', 3, 'fisik');
const entri6 = SO.kefa.racks['rak kaca lantai 1 toko'].items.NN09296.entries;
cek('6. petugas sama input lagi -> entri BARU (3 entri)', entri6.length === 3, `jumlah=${entri6.length}: ` + JSON.stringify(entri6.map((e) => [e.namaPetugas, e.qty, e.jamInput])));
cek('6b. qty MAS ANDRI pertama tetap 5 (tidak digabung)', entri6.filter((e) => e.namaPetugas === 'MAS ANDRI').map((e) => e.qty).includes(5), JSON.stringify(entri6.map((e) => [e.namaPetugas, e.qty])));
cek('6c. qty MAS ANDRI kedua tercatat 3 terpisah', entri6.filter((e) => e.namaPetugas === 'MAS ANDRI').map((e) => e.qty).includes(3), JSON.stringify(entri6.map((e) => [e.namaPetugas, e.qty])));
cek('6d. tidak ada penanda "(updated)" pada entri baru', !entri6.some((e) => /\(updated\)/i.test(e.jamInput)), JSON.stringify(entri6.map((e) => e.jamInput)));
cek('6e. total qty tetap benar (7+5+3=15)', entri6.reduce((s, e) => s + e.qty, 0) === 15, String(entri6.reduce((s, e) => s + e.qty, 0)));

// ── 6f. Kapitalisasi berbeda tetap jadi entri terpisah milik orang sama ───
F2.tambahQtyItemSO('kefa', 'rak kaca lantai 1 toko', 'NN07777', '8997270739', 'IBU FITRI DAN INTAN', 2, 'fisik');
const entri6c = SO.kefa.racks['rak kaca lantai 1 toko'].items.NN07777.entries;
cek('6f. beda kapitalisasi -> entri baru juga', entri6c.length === 2, `jumlah=${entri6c.length}`);
cek('6g. qty tetap terpisah (4 dan 2)', entri6c.map((e) => e.qty).sort().join(',') === '2,4', JSON.stringify(entri6c.map((e) => e.qty)));

// ── 6h. JENIS berbeda tetap terpisah ──────────────────────────────────────
const SOjenisBaru = buatDunia();
const FjenisBaru = buatSandbox(SOjenisBaru);
FjenisBaru.tambahQtyItemSO('kefa', 'rak kaca lantai 1 toko', 'NN09296', '8997270739', 'MAS ANDRI', 5, 'fisik');
FjenisBaru.tambahQtyItemSO('kefa', 'rak kaca lantai 1 toko', 'NN09296', '8997270739', 'MAS ANDRI', 4, 'gudang');
const entriJenis = SOjenisBaru.kefa.racks['rak kaca lantai 1 toko'].items.NN09296.entries;
cek('6h. jenis beda -> entri terpisah', entriJenis.filter((e) => e.namaPetugas === 'MAS ANDRI').length === 2, JSON.stringify(entriJenis.map((e) => [e.jenis, e.qty])));

// ── 7. Entri "(updated)" diberi peringatan data lama ─────────────────────
const hasil7 = F2.formatInfoBarangDiRakLain('kefa', 'NN02099', 'rak kaca lantai 1 toko', '8997270739', 'MAS ANDRI');
cek('7. entri bertanda -> ada peringatan data lama', /data lama/i.test(hasil7), hasil7 || '(kosong)');
cek('7b. peringatan menyebut petugas bisa tercampur', /tercampur/i.test(hasil7));
// Sandbox BERSIH: tes 5/6/6c di atas sudah menambahkan entri ke NN09296 dan
// NN07777, sehingga jam keduanya menjadi "(updated)". Untuk menguji bahwa
// entri normal TIDAK diberi peringatan, harus pakai data yang belum tersentuh.
const Fbersih7 = buatSandbox(buatDunia());
const hasil7b = Fbersih7.formatInfoBarangDiRakLain('kefa', 'NN09296', 'rak kaca lantai 1 toko', '8997270739', 'MAS ANDRI');
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
cek('10. layar "Barang ditemukan!" memuat blok riwayat', layar.includes('RIWAYAT HITUNG BARANG INI'), layar);
cek('10b. layar memuat nama petugas + jam', layar.includes('ibu fitri dan intan') && layar.includes('11:22'));
cek('10c. layar tetap memuat stok sistem', layar.includes('Stok Sistem: 120'));

// ── 11. Layar penuh: petugas yang sama tetap melihat riwayatnya ──────────
// Pakai dunia BERSIH: tes 5/6 di atas sudah menambah entri MAS ANDRI ke
// NN09296. Yang diuji di sini: petugas pemilik entri TETAP melihat nama + jam
// di layar "Barang ditemukan!", bukan layar kosong seperti dulu.
const SObersih = buatDunia();
const F3 = buatSandbox(SObersih);
const layar2 = F3.tampilkanBarangPilihan(
  { kode: 'NN09296', nama: 'PIRING BT PAUS BIRU', satuan: 'PCS', harga: { kefa: { stok: 120 } } },
  'kefa', '8997270739', 'rak kaca lantai 1 toko', 'ibu fitri dan intan'
);
cek('11. petugas sama -> layar TETAP memuat blok riwayat', layar2.includes('RIWAYAT HITUNG BARANG INI'), layar2);
cek('11b. layar memuat nama petugas', layar2.includes('ibu fitri dan intan'), layar2);
cek('11c. layar memuat jam input', layar2.includes('11:22'), layar2);
cek('11d. layar menandai entri sendiri', /\(Anda\)/i.test(layar2), layar2);

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

// ── 14. KASUS NYATA 24 Nov: NN03673 oleh "dimas" jam 09:47 ───────────────
// Inilah layar yang dilaporkan: hanya "Fisik: 16", tanpa nama petugas & jam.
// Penyebabnya entri itu milik petugas yang sedang scan, jadi dulu disembunyikan.
const SOnn = buatDunia();
SOnn.kefa.racks['RAK LANTAI 1 HOMMY'] = {
  items: {
    NN03673: {
      entries: [
        { userId: '8997270739', namaPetugas: 'dimas', qty: 16, jenis: 'fisik', jamInput: '09:47 (updated)', timestamp: 10 },
      ],
    },
  },
};
const F6 = buatSandbox(SOnn);
const layarNN = F6.tampilkanBarangPilihan(
  { kode: 'NN03673', nama: 'BOX NASI MINERVA HOMMY 3205', satuan: 'PCS', harga: { kefa: { stok: 18 } } },
  'kefa', '8997270739', 'RAK LANTAI 1 HOMMY', 'dimas'
);
cek('14. kasus nyata: layar memuat nama petugas "dimas"', /dimas/i.test(layarNN), layarNN);
cek('14b. kasus nyata: layar memuat jam 09:47', layarNN.includes('09:47'), layarNN);
cek('14c. kasus nyata: layar memuat qty 16', /16/.test(layarNN), layarNN);
cek('14d. kasus nyata: entri sendiri ditandai (Anda)', /\(Anda\)/i.test(layarNN), layarNN);

// ── 15. Beberapa petugas: SEMUA harus tampil, bukan hanya yang pertama ───
// Permintaan eksplisit: bila satu item dihitung beberapa petugas, tampilkan
// semuanya lengkap dengan qty dan jam masing-masing.
const SOmulti = buatDunia();
SOmulti.kefa.racks['rak kaca lantai 1 toko'].items.NN88888 = {
  entries: [
    { userId: '8997270739', namaPetugas: 'ibu fitri dan intan', qty: 7, jenis: 'fisik', jamInput: '08:15', timestamp: 11 },
    { userId: '8997270739', namaPetugas: 'MAS ANDRI', qty: 5, jenis: 'fisik', jamInput: '09:30', timestamp: 12 },
    { userId: '8997270739', namaPetugas: 'dimas', qty: 3, jenis: 'gudang', jamInput: '10:45', timestamp: 13 },
  ],
};
const F7 = buatSandbox(SOmulti);
const layarMulti = F7.tampilkanBarangPilihan(
  { kode: 'NN88888', nama: 'GELAS KACA', satuan: 'PCS', harga: { kefa: { stok: 20 } } },
  'kefa', '8997270739', 'rak kaca lantai 1 toko', 'dimas'
);
cek('15. tiga petugas: ibu fitri tampil', layarMulti.includes('ibu fitri dan intan'), layarMulti);
cek('15b. tiga petugas: MAS ANDRI tampil', layarMulti.includes('MAS ANDRI'), layarMulti);
cek('15c. tiga petugas: dimas tampil', /dimas/i.test(layarMulti), layarMulti);
cek('15d. jam 08:15 tampil', layarMulti.includes('08:15'), layarMulti);
cek('15e. jam 09:30 tampil', layarMulti.includes('09:30'), layarMulti);
cek('15f. jam 10:45 tampil', layarMulti.includes('10:45'), layarMulti);
cek('15g. qty 7, 5, 3 semuanya tampil', /\b7\b/.test(layarMulti) && /\b5\b/.test(layarMulti) && /\b3\b/.test(layarMulti), layarMulti);
cek('15h. jenis fisik dan gudang dibedakan', /FISIK/i.test(layarMulti) && /GUDANG/i.test(layarMulti), layarMulti);
cek('15i. hanya "dimas" yang ditandai (Anda)', (layarMulti.match(/\(Anda\)/gi) || []).length === 1, layarMulti);

// ── 16. Nama petugas kosong / null / tidak ada -> label jelas, bukan "**" ──
// Entri lama bisa tidak punya nama. Jangan sampai tampil "**" kosong atau
// teks "undefined"/"null" di layar petugas.
const SOtanpaNama = buatDunia();
SOtanpaNama.kefa.racks['rak kaca lantai 1 toko'].items.NN99999 = {
  entries: [
    { userId: '8997270739', qty: 5, jenis: 'fisik', jamInput: '08:00', timestamp: 20 },
    { userId: '8997270739', namaPetugas: null, qty: 3, jenis: 'fisik', jamInput: '09:00', timestamp: 21 },
    { userId: '8997270739', namaPetugas: '   ', qty: 2, jenis: 'fisik', jamInput: '10:00', timestamp: 22 },
  ],
};
const F8 = buatSandbox(SOtanpaNama);
const hasilTanpaNama = F8.formatInfoBarangDiRakLain('kefa', 'NN99999', 'rak kaca lantai 1 toko', '8997270739', 'dimas');
cek('16. nama kosong tidak crash', typeof hasilTanpaNama === 'string');
cek('16b. tidak menampilkan "undefined"', !/undefined/i.test(hasilTanpaNama), hasilTanpaNama);
cek('16c. tidak menampilkan "null"', !/\bnull\b/i.test(hasilTanpaNama), hasilTanpaNama);
cek('16d. tidak ada bold kosong "**"', !/\*\*[ \t]*\*/.test(hasilTanpaNama), hasilTanpaNama);
cek('16e. ada label pengganti yang terbaca', /TANPA NAMA/i.test(hasilTanpaNama), hasilTanpaNama);
cek('16f. jam dan qty tetap tampil', hasilTanpaNama.includes('08:00') && hasilTanpaNama.includes('10:00') && /\b5\b/.test(hasilTanpaNama), hasilTanpaNama);

// ── 17. KASUS NYATA: "Tri" input TOKO 2 lalu TOKO 4 ──────────────────────
// Yang dilaporkan: layar menampilkan "Tri (Anda) 10:27 (updated) | FISIK: 6"
// - dua input berbeda waktu digabung jadi satu baris, jam aslinya hilang.
// Yang benar: dua baris terpisah, masing-masing dengan qty dan jam:menitnya.
const SOtri = buatDunia();
const Ftri = buatSandbox(SOtri);
const RAKTRI = 'rak kaca lantai 1 toko';
Ftri.tambahInputSO('kefa', RAKTRI, 'NN55555', '8997270739', 'Dimas', 12, 'fisik');
Ftri.tambahInputSO('kefa', RAKTRI, 'NN55555', '8997270739', 'Irwan', 4, 'fisik');
Ftri.tambahQtyItemSO('kefa', RAKTRI, 'NN55555', '8997270739', 'Tri', 2, 'fisik');
Ftri.tambahQtyItemSO('kefa', RAKTRI, 'NN55555', '8997270739', 'Tri', 4, 'fisik');

const entriTri = SOtri.kefa.racks[RAKTRI].items.NN55555.entries.filter((e) => e.namaPetugas === 'Tri');
cek('17. Tri input 2x -> 2 entri terpisah', entriTri.length === 2, `jumlah=${entriTri.length}: ` + JSON.stringify(entriTri.map((e) => [e.qty, e.jamInput])));
cek('17b. qty 2 dan 4 tersimpan terpisah', entriTri.map((e) => e.qty).sort().join(',') === '2,4', JSON.stringify(entriTri.map((e) => e.qty)));
cek('17c. tidak ada penanda "(updated)"', !entriTri.some((e) => /\(updated\)/i.test(e.jamInput)), JSON.stringify(entriTri.map((e) => e.jamInput)));
cek('17d. total tetap 22 (12+4+2+4)', SOtri.kefa.racks[RAKTRI].items.NN55555.entries.reduce((s, e) => s + e.qty, 0) === 22, String(SOtri.kefa.racks[RAKTRI].items.NN55555.entries.reduce((s, e) => s + e.qty, 0)));

const layarTri = Ftri.tampilkanBarangPilihan(
  { kode: 'NN55555', nama: 'BOX NASI MINERVA HOMMY 3205', satuan: 'PCS', harga: { kefa: { stok: 18 } } },
  'kefa', '8997270739', RAKTRI, 'Tri'
);
cek('17e. layar memuat 4 baris riwayat (bukan 3)', (layarTri.match(/^\d+\. \*/gm) || []).length === 4, layarTri);
cek('17f. baris Tri muncul 2x', (layarTri.match(/\*Tri\*/gi) || []).length === 2, layarTri);
cek('17g. qty 2 tampil terpisah', /\bFISIK: 2\b/.test(layarTri), layarTri);
cek('17h. qty 4 tampil terpisah', /\bFISIK: 4\b/.test(layarTri), layarTri);
cek('17i. qty gabungan 6 TIDAK tampil sebagai satu baris', !/FISIK: 6\b/.test(layarTri), layarTri);
cek('17j. tidak ada peringatan "data lama"', !/data lama/i.test(layarTri), layarTri);

// ── 18. Sumber kode layar EDIT RAK / EDIT ITEM juga merinci per entry ────
// Layar itu tidak bisa dijalankan di sandbox (butuh chatId/kirim), jadi yang
// diuji adalah teks yang dibangun: tiap entri harus menyertakan jam:menit.
const fs18 = require('fs');
const src18 = fs18.readFileSync(require('path').join(__dirname, '..', 'index.js'), 'utf8');
cek('18. layar EDIT RAK menampilkan jam per entry', /entries\.forEach\(e => \{[\s\S]{0,400}jamInput/.test(src18), 'pola tidak ditemukan');
cek('18b. layar EDIT RAK meng-escape nama petugas', /escapeMd\(e\.namaPetugas\)/.test(src18), 'escapeMd tidak dipakai');
cek('18c. layar EDIT ITEM meng-escape nama petugas', /escapeMd\(entry\.namaPetugas\)/.test(src18), 'escapeMd tidak dipakai');
cek('18d. layar EDIT ITEM meng-escape jam', /escapeMd\(entry\.jamInput\)/.test(src18), 'escapeMd tidak dipakai');
cek('18e. tidak ada lagi penggabungan qty (qty +=)', !/entries\[existIdx\]\.qty\s*\+=/.test(src18), 'masih ada penggabungan qty');
cek('18f. tidak ada lagi penulisan jam "(updated)" saat tambah', !/jamInput\s*=\s*getJamSekarang\(\)\s*\+\s*' \(updated\)'/.test(src18), 'masih menimpa jam dengan (updated)');

// ── 19. Nama petugas disamakan ke ejaan yang sudah ada (Dimas vs dimas) ──
// Laporan Excel memisahkan "Petugas 1: dimas" dan "Petugas 2: Dimas" padahal
// itu orang yang sama. Pencocokan sudah benar (kunciPetugas), tetapi nama
// TERSIMPAN apa adanya sehingga rekap/laporan memecah satu orang jadi dua.
const daftar19 = [
  { nama: 'Dimas', terakhir: 100 },
  { nama: 'Tri', terakhir: 200 },
];
cek('19. nama beda kapitalisasi disamakan ke ejaan lama', F2.samakanNamaPetugas('dimas', daftar19) === 'Dimas', F2.samakanNamaPetugas('dimas', daftar19));
cek('19b. ejaan persis tetap dipakai', F2.samakanNamaPetugas('Dimas', daftar19) === 'Dimas');
cek('19c. spasi berlebih dirapikan', F2.samakanNamaPetugas('  DIMAS  ', daftar19) === 'Dimas');
cek('19d. nama baru (belum ada) tetap dipakai apa adanya', F2.samakanNamaPetugas('Budi', daftar19) === 'Budi');
cek('19e. nama baru dengan spasi berlebih dirapikan', F2.samakanNamaPetugas('  Budi   Santoso ', daftar19) === 'Budi Santoso');
cek('19f. nama kosong aman', F2.samakanNamaPetugas('', daftar19) === '' && F2.samakanNamaPetugas(null, daftar19) === '');
cek('19g. daftar kosong aman', F2.samakanNamaPetugas('dimas', []) === 'dimas');
cek('19h. pilih ejaan yang paling sering/terakhir dipakai', F2.samakanNamaPetugas('dimas', [
  { nama: 'DIMAS', terakhir: 50 },
  { nama: 'Dimas', terakhir: 300 },
  { nama: 'dimas', terakhir: 100 },
]) === 'Dimas');

// ── 20. Daftar petugas untuk dipilih: online + offline, tanpa duplikat ───
// Layar "Siapa nama Anda?" hanya menampilkan petugas yang sedang online.
// Petugas yang sudah pernah input (termasuk yang offline) harus ikut muncul
// supaya bisa dipilih langsung tanpa mengetik manual.
const dunia20 = buatDunia();
dunia20.kefa.usersAktif = {
  '111': { nama: 'Dimas', petugas: ['Dimas'], rakAktif: 'rak kaca lantai 1 toko', jamMulai: '08:00', lastActive: 300 },
};
dunia20.kefa.racks['rak kaca lantai 1 toko'].items.NN77777 = {
  entries: [
    { userId: '222', namaPetugas: 'Tri', qty: 2, jenis: 'fisik', jamInput: '09:00', timestamp: 100 },
    { userId: '222', namaPetugas: 'dimas', qty: 3, jenis: 'fisik', jamInput: '09:10', timestamp: 200 },
    { userId: '333', namaPetugas: 'Irwan', qty: 1, jenis: 'fisik', jamInput: '09:20', timestamp: 150 },
  ],
};
const F20 = buatSandbox(dunia20);
const daftar20 = F20.getDaftarPetugasSO('kefa');
cek('20. petugas online ikut terdaftar', daftar20.some((p) => p.nama === 'Dimas'), JSON.stringify(daftar20));
cek('20b. petugas offline (pernah input) ikut terdaftar', daftar20.some((p) => p.nama === 'Tri'), JSON.stringify(daftar20));
cek('20c. petugas offline lain ikut terdaftar', daftar20.some((p) => p.nama === 'Irwan'), JSON.stringify(daftar20));
cek('20d. "dimas" tidak jadi entri terpisah dari "Dimas"', daftar20.filter((p) => /^dimas$/i.test(p.nama)).length === 1, JSON.stringify(daftar20.map((p) => p.nama)));
cek('20e. petugas online ditandai online', daftar20.find((p) => p.nama === 'Dimas')?.online === true, JSON.stringify(daftar20));
cek('20f. petugas offline ditandai offline', daftar20.find((p) => p.nama === 'Tri')?.online === false, JSON.stringify(daftar20));
cek('20g. rak petugas online ikut terbawa', daftar20.find((p) => p.nama === 'Dimas')?.rakAktif === 'rak kaca lantai 1 toko', JSON.stringify(daftar20));
cek('20h. daftar urut: online dulu, lalu nama', daftar20[0].online === true, JSON.stringify(daftar20.map((p) => [p.nama, p.online])));
cek('20i. tidak ada nama kosong di daftar', !daftar20.some((p) => !p.nama || !String(p.nama).trim()), JSON.stringify(daftar20));

console.log('');
console.log('────────────────────────────────────────────');
console.log(`  LULUS: ${lulus}   GAGAL: ${gagal}`);
console.log('────────────────────────────────────────────');
process.exit(gagal === 0 ? 0 : 1);

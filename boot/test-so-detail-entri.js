// test-so-detail-entri.js
// Setiap entri Stock Opname harus tampil LENGKAP: nama petugas, tanggal, jam:menit,
// rak, jenis (FISIK/GUDANG), dan qty per entry — bukan hasil penjumlahan.
//
// Kenapa tes ini ada (permintaan pemilik 24 Nov 2026):
//   "tampilkan detail semua nama petugas di hari tanggal berapa jam berapa di rak
//    mana di gudang mana beserta jumlah per entrynya dan tanggal serta jam dan
//    menit lengkap"
//
// Jam otoritatif = timestamp (ada di SEMUA entri, termasuk data lama). jamInput
// hanya HH:MM dan bisa berakhiran "(updated)"/"(edited)", jadi hanya dipakai
// sebagai cadangan bila timestamp tidak ada.
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
  return SUMBER.slice(m.index, i);
}

// Konstanta dari index.js disuntikkan otomatis supaya tes tidak perlu
// memperbarui daftar manual setiap kali konstanta baru ditambahkan.
const SUMBER_KONSTANTA = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const KONSTANTA_ANGKA = [...SUMBER_KONSTANTA.matchAll(/^const\s+([A-Z][A-Z0-9_]*)\s*=\s*([^;\n]+);/gm)]
  .filter((m) => /^[\d\s*+\-/().]+$/.test(m[2].trim()))
  .map((m) => `const ${m[1]} = ${m[2].trim()};`)
  .join('\n');

const FUNGSI = [
  'getJakartaDate',
  'getTanggalSlash',
  'getJamSekarang',
  'msMasukAkal',
  'tanggalKeMs',
  'formatTanggalDariMs',
  'formatJamDariMs',
  'tanggalEntri',
  'jamEntri',
  'hitungTotalSO',
  'tandaiHitungUlangSO',
  'kunciPetugas',
  'escapeMd',
  'getBarangDiSemuaRak',
  'getTotalBarangSemuaRak',
  'formatInfoBarangDiRakLain',
];

const sumberFungsi = FUNGSI.map(ambilFungsi).join('\n\n');

function buatSandbox(so) {
  const src = `
    const SO = arguments[0];
    const getSOShared = (toko) => SO[toko];
    const saveShared = () => {};
    const GARIS_TEBAL = '━━━━━━━━━━━━━━━━━━━━';
    const GARIS_TIPIS = '────────────────────';
    ${KONSTANTA_ANGKA}
    ${sumberFungsi}
    return { ${FUNGSI.join(', ')} };
  `;
  return new Function(src)(so);
}

// 24 Nov 2026 10:25 WITA
const MS_24_1025 = Date.parse('2026-11-24T02:25:00Z');
// 25 Nov 2026 14:07 WITA
const MS_25_1407 = Date.parse('2026-11-25T06:07:00Z');
// 26 Nov 2026 09:12 WITA
const MS_26_0912 = Date.parse('2026-11-26T01:12:00Z');

const RAK_A = 'rak lantai 1 hommy';
const RAK_G = 'rak gudang belakang';

function dunia() {
  return {
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
                { userId: '8997270739', namaPetugas: 'Tri', qty: 4, jenis: 'fisik', jamInput: '14:07', timestamp: MS_25_1407, tanggal: '25/11/2026' },
              ],
            },
          },
        },
        [RAK_G]: {
          items: {
            NN09999: {
              entries: [
                { userId: '8997270739', namaPetugas: 'Irwan', qty: 8, jenis: 'gudang', jamInput: '09:12', timestamp: MS_26_0912, tanggal: '26/11/2026' },
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

console.log('=== Uji Stock Opname: detail lengkap per entri ===\n');

// ── 1. Enam hal yang diminta ada di setiap baris ─────────────────────────
{
  const F = buatSandbox(dunia());
  const layar = F.formatInfoBarangDiRakLain('kefa', 'NN03673', RAK_A, '8997270739', 'Dimas');
  cek('1. nama petugas tampil', layar.includes('Dimas') && layar.includes('Tri'), layar);
  cek('1b. tanggal tampil', layar.includes('24/11/2026') && layar.includes('25/11/2026'), layar);
  cek('1c. jam:menit tampil', layar.includes('10:25') && layar.includes('14:07'), layar);
  cek('1d. rak tampil', layar.includes(RAK_A), layar);
  cek('1e. jenis (gudang/fisik) tampil', /FISIK/i.test(layar), layar);
  cek('1f. qty per entry tampil terpisah', /\b12\b/.test(layar) && /\b4\b/.test(layar), layar);
  cek('1g. judul blok riwayat ada', layar.includes('RIWAYAT HITUNG BARANG INI'), layar);
}

// ── 2. Tiga petugas, tiga tanggal, tidak tergabung ───────────────────────
{
  const F = buatSandbox(dunia());
  const layar = F.formatInfoBarangDiRakLain('kefa', 'NN09999', RAK_G, '8997270739', 'Dimas');
  cek('2. petugas gudang tampil', layar.includes('Irwan'), layar);
  cek('2b. jenis GUDANG tampil', /GUDANG/i.test(layar), layar);
  cek('2c. tanggalnya tampil', layar.includes('26/11/2026'), layar);
  cek('2d. jamnya tampil', layar.includes('09:12'), layar);
}

// ── 3. Qty yang tampil = qty entri itu, BUKAN total ─────────────────────
{
  const F = buatSandbox(dunia());
  const layar = F.formatInfoBarangDiRakLain('kefa', 'NN03673', RAK_A, '8997270739', 'Dimas');
  // Total 12 + 4 = 16. Kedua angka asli harus tampil, dan 16 hanya di ringkasan.
  cek('3. qty 12 dan 4 tampil per entry', /\b12\b/.test(layar) && /\b4\b/.test(layar), layar);
  cek('3b. tidak menggantikan qty entry dengan total', !/FISIK:\s*\*?16/.test(layar), layar);
}

// ── 4. Entri tanpa tanggal -> tanggal diturunkan dari timestamp ──────────
{
  const d = dunia();
  delete d.kefa.racks[RAK_A].items.NN03673.entries[0].tanggal;
  const F = buatSandbox(d);
  const layar = F.formatInfoBarangDiRakLain('kefa', 'NN03673', RAK_A, '8997270739', 'Dimas');
  cek('4. tanggal diturunkan dari timestamp', layar.includes('24/11/2026'), layar);
}

// ── 5. Entri tanpa timestamp -> jatuh ke jamInput ───────────────────────
{
  const d = dunia();
  delete d.kefa.racks[RAK_A].items.NN03673.entries[0].timestamp;
  delete d.kefa.racks[RAK_A].items.NN03673.entries[0].tanggal;
  const F = buatSandbox(d);
  const layar = F.formatInfoBarangDiRakLain('kefa', 'NN03673', RAK_A, '8997270739', 'Dimas');
  cek('5. tanpa timestamp: jam dari jamInput', layar.includes('10:25'), layar);
  cek('5b. tanpa timestamp: tidak menampilkan undefined/NaN',
    !/undefined|NaN/i.test(layar), layar);
}

// ── 6. jamInput berakhiran (updated)/(edited) dibersihkan ───────────────
{
  const d = dunia();
  d.kefa.racks[RAK_A].items.NN03673.entries[0].jamInput = '10:30 (updated)';
  delete d.kefa.racks[RAK_A].items.NN03673.entries[0].timestamp;
  delete d.kefa.racks[RAK_A].items.NN03673.entries[0].tanggal;
  const F = buatSandbox(d);
  const layar = F.formatInfoBarangDiRakLain('kefa', 'NN03673', RAK_A, '8997270739', 'Dimas');
  cek('6. sufiks (updated) tidak ikut tampil di jam', !/10:30 \(updated\)/.test(layar), layar);
  cek('6b. jam bersih 10:30 tetap tampil', layar.includes('10:30'), layar);
  cek('6c. peringatan data lama tetap ada', /data lama/i.test(layar), layar);
}

// ── 7. Penanda "dihitung ulang" untuk hari yang digantikan ──────────────
{
  const d = dunia();
  // Tambah hitungan hari ke-3 untuk barang yang sama (rak sama) -> hari lama diganti.
  d.kefa.racks[RAK_A].items.NN03673.entries.push(
    { userId: '8997270739', namaPetugas: 'Dimas', qty: 7, jenis: 'fisik', jamInput: '08:00', timestamp: MS_26_0912, tanggal: '26/11/2026' }
  );
  const F = buatSandbox(d);
  const layar = F.formatInfoBarangDiRakLain('kefa', 'NN03673', RAK_A, '8997270739', 'Dimas');
  cek('7. entri hari lama ditandai dihitung ulang', /dihitung ulang/i.test(layar), layar);
  cek('7b. semua entri tetap ditampilkan (3)', (layar.match(/^\d+\. /gm) || []).length === 3, layar);
  cek('7c. ringkasan total memakai hari terakhir = 7', /Total dihitung:\*?\s*7\b/.test(layar), layar);
}

// ── 7d. Penanda per baris: hanya entri yang digantikan yang ditandai ────
{
  const d = dunia();
  // Hari ke-3 hitung ulang 7 -> entri 24/11 & 25/11 digantikan.
  d.kefa.racks[RAK_A].items.NN03673.entries.push(
    { userId: '8997270739', namaPetugas: 'Dimas', qty: 7, jenis: 'fisik', jamInput: '08:00', timestamp: MS_26_0912, tanggal: '26/11/2026' }
  );
  const F = buatSandbox(d);
  const layar = F.formatInfoBarangDiRakLain('kefa', 'NN03673', RAK_A, '8997270739', 'Dimas');
  const jumlahTanda = (layar.match(/dihitung ulang di hari lain/g) || []).length;
  // 2 entri lama ditandai + 1 baris ringkasan di bawah.
  cek('7d. dua entri lama ditandai (bukan semua)', jumlahTanda === 3, `${jumlahTanda} tanda`);
  // Entri hari terakhir TIDAK boleh ditandai.
  const barisEntri = layar.split('\n');
  const iEntri7 = barisEntri.findIndex((b) => /\*7\*/.test(b));
  const iEntri9 = barisEntri.findIndex((b) => /\*9\*/.test(b) || /\*12\*/.test(b));
  cek('7e. entri hari terakhir tidak ditandai',
    iEntri7 >= 0 && !/dihitung ulang/.test(barisEntri[iEntri7 + 1] || ''),
    barisEntri.slice(iEntri7, iEntri7 + 2).join(' / '));
}

// ── 7f. Semua entri di hari yang sama: TIDAK ada tanda dihitung ulang ──
{
  const d = dunia();
  d.kefa.racks[RAK_A].items.NN03673.entries = [
    { userId: '8997270739', namaPetugas: 'Tri', qty: 2, jenis: 'fisik', jamInput: '10:00', timestamp: MS_24_1025, tanggal: '24/11/2026' },
    { userId: '8997270739', namaPetugas: 'Tri', qty: 4, jenis: 'fisik', jamInput: '11:00', timestamp: MS_24_1025 + 3600000, tanggal: '24/11/2026' },
  ];
  const F = buatSandbox(d);
  const layar = F.formatInfoBarangDiRakLain('kefa', 'NN03673', RAK_A, '8997270739', 'Dimas');
  cek('7f. hari sama: tidak ada tanda dihitung ulang', !/dihitung ulang/i.test(layar), layar);
  cek('7g. hari sama: total 2 + 4 = 6', /Total dihitung:\*?\s*6\b/.test(layar), layar);
}
// ── 8. Ringkasan menyebut jumlah input ──────────────────────────────────
{
  const F = buatSandbox(dunia());
  const layar = F.formatInfoBarangDiRakLain('kefa', 'NN03673', RAK_A, '8997270739', 'Dimas');
  cek('8. ringkasan "dari N input" ada', /dari\s+2\s+input/i.test(layar), layar);
}

// ── 9. Entri tanpa nama tetap aman (tidak "**" kosong) ──────────────────
{
  const d = dunia();
  d.kefa.racks[RAK_A].items.NN03673.entries[0].namaPetugas = '   ';
  const F = buatSandbox(d);
  const layar = F.formatInfoBarangDiRakLain('kefa', 'NN03673', RAK_A, '8997270739', 'Dimas');
  cek('9. nama kosong -> label TANPA NAMA', /TANPA NAMA/i.test(layar), layar);
  cek('9b. tidak ada bold kosong', !/\*\*[ \t]*\*/.test(layar), layar);
}

// ── 10. Nama ber-underscore di-escape (Markdown) ────────────────────────
{
  const d = dunia();
  d.kefa.racks[RAK_A].items.NN03673.entries[0].namaPetugas = 'Budi_Santoso';
  const F = buatSandbox(d);
  const layar = F.formatInfoBarangDiRakLain('kefa', 'NN03673', RAK_A, '8997270739', 'Dimas');
  cek('10. nama ber-underscore di-escape', layar.includes('Budi\\_Santoso'), layar);
}

// ── 11. Sumber kode: laporan memuat detail per entri ────────────────────
{
  const badanLaporan = ambilFungsi('generateLaporanSOGabungan');
  cek('11. laporan punya bagian DETAIL PER ENTRI', /DETAIL PER ENTRI/i.test(badanLaporan),
    'bagian detail tidak ditemukan');
  cek('11b. laporan memakai tanggalEntri', /tanggalEntri\(/.test(badanLaporan),
    'tanggalEntri tidak dipakai');
  cek('11c. laporan memakai jamEntri', /jamEntri\(/.test(badanLaporan),
    'jamEntri tidak dipakai');
  cek('11d. laporan menampilkan rak per entri', /Rak:/i.test(badanLaporan), 'rak tidak ditampilkan');
  cek('11e. laporan menampilkan qty per entri', /qty/i.test(badanLaporan), 'qty tidak ditampilkan');
}

// ── 12. Sumber kode: Excel memuat Tanggal + Jam + sheet detail ──────────
{
  const badanExcel = ambilFungsi('generateExcelSOGabungan');
  cek('12. Excel per rak punya kolom Tanggal', /header:\s*'Tanggal'/.test(badanExcel),
    'kolom Tanggal tidak ada');
  cek('12b. Excel per rak punya kolom Jam', /header:\s*'Jam'/.test(badanExcel),
    'kolom Jam tidak ada');
  cek('12c. Excel punya sheet "Detail Semua Entri"', /Detail Semua Entri/.test(badanExcel),
    'sheet detail tidak ada');
  cek('12d. Excel memakai tanggalEntri & jamEntri',
    /tanggalEntri\(/.test(badanExcel) && /jamEntri\(/.test(badanExcel),
    'helper tanggal/jam tidak dipakai');
}

// ── 13. Sumber kode: pesan panjang tetap dipecah di batas baris ─────────
{
  const badanSplit = ambilFungsi('splitMessage');
  cek('13. splitMessage memecah per baris', /split\('\\n'\)/.test(badanSplit), 'tidak memecah per baris');
  cek('13b. splitMessage tidak memotong baris normal di tengah',
    /line\.length > maxLength/.test(badanSplit), 'tidak ada penjagaan baris panjang');
}

console.log('');
console.log(`LULUS: ${lulus}   GAGAL: ${gagal}`);
process.exit(gagal === 0 ? 0 : 1);

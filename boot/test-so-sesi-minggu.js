// test-so-sesi-minggu.js
// Stock Opname harus bertahan 1 minggu penuh (7x24 jam), bukan reset tiap hari.
//
// Kenapa tes ini ada (keluhan pemilik 24 Nov 2026):
//   "buat so ini berlaku selama 1 minggu penuh ... jangan sampai coba untuk besok
//    lanjut SO tidak bisa berlanjut bertahan 1 minggu full jangan cuman 1 hari
//    langsung mulai awal dari baru"
//
// Akar masalah: getSOShared() mereset seluruh data setiap kali tanggal berganti
// (SO_SHARED[toko].tanggal !== getTanggalSlash(false)), sehingga hari berikutnya
// semua rak + entri + daftar petugas hilang.
//
// Keputusan pemilik:
//   - patokan 1 minggu = 7x24 jam sejak mulai/reset
//   - saat habis      = reset otomatis DENGAN backup
//   - hitung ulang barang sama di hari berbeda = total pakai hitungan TERAKHIR
//     (di dalam hari yang sama tetap dijumlah: Tri 2 lalu 4 = 6)
//
// Tes ini TIDAK menyalin fungsi: ia membaca index.js, mengambil fungsi aslinya,
// lalu menjalankannya dengan dependensi tiruan.
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

// ─────────── Ambil fungsi asli dari index.js ───────────
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

// ─────────── Konstanta yang diuji ───────────
// Konstanta diambil dari index.js supaya tes ikut menguji nilai sebenarnya.
const mSeminggu = /const\s+SEMINGGU_MS\s*=\s*([^;]+);/.exec(SUMBER);
if (!mSeminggu) throw new Error('konstanta SEMINGGU_MS tidak ditemukan di index.js');
const SEMINGGU_MS = new Function(`return (${mSeminggu[1]});`)();

const SEHARI = 24 * 60 * 60 * 1000;
const SEMINGGU = 7 * SEHARI;

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
  'buatSharedKosong',
  'getSOShared',
  'backupSOShared',
  'saveShared',
  'hitungTotalSO',
  'tambahInputSO',
  'tambahQtyItemSO',
  'getBarangDiSemuaRak',
  'getTotalBarangSemuaRak',
  'getSOGabunganData',
  'getAllItemsSO',
  'resetSOSharedToko',
];

const sumberFungsi = FUNGSI.map(ambilFungsi).join('\n\n');

// ─────────── Sandbox ───────────
// SO_SHARED, STOCKOPNAME, saveJSON disuntikkan sebagai tiruan supaya fungsi asli
// bisa dijalankan tanpa menyentuh berkas.
function buatSandbox(opsi = {}) {
  const jam = opsi.jam === undefined ? 0 : opsi.jam; // offset ms dari sekarang
  const simpan = [];
  const src = `
    const arguments0 = arguments[0];
    const SO_SHARED = arguments0.soShared;
    const STOCKOPNAME = arguments0.stockopname;
    const OFFSET_JAM = arguments0.offset;
    // Date tiruan: geser "sekarang" tanpa mengubah perilaku Date lainnya.
    // Diambil lewat globalThis supaya tidak kena TDZ saat nama Date di-shadow.
    const DateAsli = globalThis.Date;
    function DateTiruan(...a) {
      if (a.length === 0) return new DateAsli(DateAsli.now() + OFFSET_JAM);
      return new DateAsli(...a);
    }
    DateTiruan.now = () => DateAsli.now() + OFFSET_JAM;
    DateTiruan.parse = DateAsli.parse;
    DateTiruan.UTC = DateAsli.UTC;
    DateTiruan.prototype = DateAsli.prototype;
    const Date = DateTiruan;
    const CONFIG = { paths: { soShared: 'soShared.json', stockopname: 'stockopname.json' } };
    const saveJSON = (p, d) => { arguments0.simpan.push({ p, d: JSON.parse(JSON.stringify(d)) }); };
    const triggerBackupAfterEvent = null;
    ${KONSTANTA_ANGKA}
    ${sumberFungsi}
    return {
      SO_SHARED, STOCKOPNAME, simpan: arguments0.simpan,
      ${FUNGSI.join(', ')},
    };
  `;
  const soShared = opsi.soShared || {};
  const stockopname = opsi.stockopname || {};
  return new Function(src)({ soShared, stockopname, offset: jam, simpan, semingguMs: SEMINGGU_MS });
}

console.log('=== Uji Stock Opname: sesi 1 minggu penuh ===\n');

// ── 1. getSOShared membuat sesi 7 hari untuk data baru ────────────────────
{
  const F = buatSandbox();
  const shared = F.getSOShared('kefa');
  cek('1. sesi baru punya sesiMulai', Number.isFinite(shared.sesiMulai), JSON.stringify(shared));
  cek('1b. sesi baru punya sesiBerakhir', Number.isFinite(shared.sesiBerakhir), JSON.stringify(shared));
  cek('1c. masa berlaku tepat 7x24 jam', shared.sesiBerakhir - shared.sesiMulai === SEMINGGU,
    `${shared.sesiBerakhir - shared.sesiMulai} ms`);
  cek('1d. tanggal = tanggal mulai sesi', shared.tanggal === F.getTanggalSlash(false),
    `${shared.tanggal} vs ${F.getTanggalSlash(false)}`);
}

// ── 2. TIDAK reset saat tanggal berganti (inti keluhan) ───────────────────
{
  const F = buatSandbox();
  F.tambahInputSO('kefa', 'rak a', 'NN1', '111', 'Dimas', 5, 'fisik');
  const sesiAwal = F.SO_SHARED.kefa.sesiBerakhir;
  // Maju 1 hari, lalu panggil getSOShared seperti request berikutnya.
  const F2 = buatSandbox({ soShared: F.SO_SHARED, jam: SEHARI });
  const shared2 = F2.getSOShared('kefa');
  cek('2. data TETAP ada setelah 1 hari', Object.keys(shared2.racks).length === 1,
    JSON.stringify(Object.keys(shared2.racks)));
  cek('2b. entri tidak hilang setelah 1 hari',
    shared2.racks['rak a'].items.NN1.entries.length === 1,
    JSON.stringify(shared2.racks['rak a']?.items?.NN1?.entries));
  cek('2c. sesiBerakhir tidak bergeser', shared2.sesiBerakhir === sesiAwal,
    `${shared2.sesiBerakhir} vs ${sesiAwal}`);
  cek('2d. tidak ada backup yang terpicu', F2.STOCKOPNAME.kefa === undefined,
    JSON.stringify(F2.STOCKOPNAME));
}

// ── 3. Masih hidup di hari ke-3 dan ke-6 ─────────────────────────────────
{
  const F = buatSandbox();
  F.tambahInputSO('kefa', 'rak a', 'NN1', '111', 'Dimas', 5, 'fisik');
  for (const hari of [3, 6]) {
    const Fn = buatSandbox({ soShared: F.SO_SHARED, jam: hari * SEHARI });
    const s = Fn.getSOShared('kefa');
    cek(`3. hari ke-${hari}: data masih ada`, Object.keys(s.racks).length === 1,
      JSON.stringify(Object.keys(s.racks)));
  }
}

// ── 4. Reset otomatis setelah lewat 7 hari, DENGAN backup ────────────────
{
  const F = buatSandbox();
  F.tambahInputSO('kefa', 'rak a', 'NN1', '111', 'Dimas', 5, 'fisik');
  const F8 = buatSandbox({ soShared: F.SO_SHARED, jam: 8 * SEHARI });
  const s8 = F8.getSOShared('kefa');
  cek('4. setelah 8 hari data dikosongkan', Object.keys(s8.racks).length === 0,
    JSON.stringify(Object.keys(s8.racks)));
  cek('4b. data lama DIBACKUP ke riwayat',
    Array.isArray(F8.STOCKOPNAME.kefa) && F8.STOCKOPNAME.kefa.length === 1,
    JSON.stringify(F8.STOCKOPNAME.kefa?.length));
  cek('4c. backup memuat entri lama',
    F8.STOCKOPNAME.kefa?.[0]?.sharedData?.racks?.['rak a']?.items?.NN1?.entries?.length === 1,
    JSON.stringify(F8.STOCKOPNAME.kefa?.[0]?.sharedData?.racks));
  cek('4d. sesi baru mulai 7 hari lagi',
    s8.sesiBerakhir - s8.sesiMulai === SEMINGGU, `${s8.sesiBerakhir - s8.sesiMulai} ms`);
}

// ── 5. Tepat di batas belum reset; lewat sedikit baru reset ──────────────
{
  const F = buatSandbox();
  F.tambahInputSO('kefa', 'rak a', 'NN1', '111', 'Dimas', 5, 'fisik');
  const berakhir = F.SO_SHARED.kefa.sesiBerakhir;
  // Jarak 1 menit dipakai supaya selisih beberapa milidetik antara perhitungan
  // di sini dan pemanggilan sandbox tidak membuat tes ini gagal acak.
  const sBatas = buatSandbox({ soShared: F.SO_SHARED, jam: berakhir - Date.now() - 60000 }).getSOShared('kefa');
  cek('5. tepat di batas sesi BELUM reset', Object.keys(sBatas.racks).length === 1,
    JSON.stringify(Object.keys(sBatas.racks)));
  const sLewat = buatSandbox({ soShared: F.SO_SHARED, jam: berakhir - Date.now() + 1000 }).getSOShared('kefa');
  cek('5b. 1 detik setelah batas -> reset', Object.keys(sLewat.racks).length === 0,
    JSON.stringify(Object.keys(sLewat.racks)));
}

// ── 6. Data lama tanpa sesiMulai tidak hilang ────────────────────────────
{
  const lama = {
    kefa: {
      tanggal: '24/11/2026', // data lama: hanya tanggal, tanpa sesiMulai
      sesiAktif: true,
      racks: { 'rak lama': { items: { NN9: { entries: [
        { userId: '111', namaPetugas: 'Dimas', qty: 3, jenis: 'fisik', jamInput: '09:00', timestamp: 1 },
      ] } } } },
      usersAktif: { '111': { nama: 'Dimas', petugas: ['Dimas'], rakAktif: 'rak lama', jamMulai: '08:00', lastActive: 1 } },
      barangBaru: [],
    },
  };
  const F = buatSandbox({ soShared: lama });
  const s = F.getSOShared('kefa');
  cek('6. data lama TIDAK dihapus', Object.keys(s.racks).length === 1, JSON.stringify(Object.keys(s.racks)));
  cek('6b. entri data lama utuh', s.racks['rak lama'].items.NN9.entries.length === 1);
  cek('6c. sesiMulai diisi otomatis', Number.isFinite(s.sesiMulai), JSON.stringify(s.sesiMulai));
  cek('6d. sesiBerakhir diisi otomatis', s.sesiBerakhir - s.sesiMulai === SEMINGGU,
    `${s.sesiBerakhir - s.sesiMulai} ms`);
  cek('6e. usersAktif data lama utuh', Object.keys(s.usersAktif).length === 1);
}

// ── 7. hitungTotalSO: dalam hari yang sama DIJUMLAH ─────────────────────
{
  const F = buatSandbox();
  const t = F.hitungTotalSO([
    { namaPetugas: 'Tri', qty: 2, jenis: 'fisik', tanggal: '24/11/2026', timestamp: 1 },
    { namaPetugas: 'Tri', qty: 4, jenis: 'fisik', tanggal: '24/11/2026', timestamp: 2 },
  ]);
  cek('7. Tri 2 lalu 4 di hari sama = 6', t.fisik === 6, JSON.stringify(t));
  cek('7b. tidak ada hitung ulang', t.adaHitungUlang === false, JSON.stringify(t));
  cek('7c. total = fisik + gudang', t.total === t.fisik + t.gudang, JSON.stringify(t));
}

// ── 8. hitungTotalSO: hari berbeda -> hari TERAKHIR menang ──────────────
{
  const F = buatSandbox();
  const t = F.hitungTotalSO([
    { namaPetugas: 'Dimas', qty: 10, jenis: 'fisik', tanggal: '24/11/2026', timestamp: 1 },
    { namaPetugas: 'Dimas', qty: 8, jenis: 'fisik', tanggal: '27/11/2026', timestamp: 2 },
  ]);
  cek('8. hitung ulang antar hari: 10 lalu 8 = 8 (bukan 18)', t.fisik === 8, JSON.stringify(t));
  cek('8b. ditandai ada hitung ulang', t.adaHitungUlang === true, JSON.stringify(t));
  cek('8c. total ikut 8', t.total === 8, JSON.stringify(t));
}

// ── 9. hitungTotalSO: hari terakhir menang, di dalam hari dijumlah ───────
{
  const F = buatSandbox();
  const t = F.hitungTotalSO([
    { qty: 10, jenis: 'fisik', tanggal: '24/11/2026', timestamp: 1 },
    { qty: 3, jenis: 'fisik', tanggal: '27/11/2026', timestamp: 2 },
    { qty: 2, jenis: 'fisik', tanggal: '27/11/2026', timestamp: 3 },
  ]);
  cek('9. hari terakhir (3+2) menang atas hari lama (10) = 5', t.fisik === 5, JSON.stringify(t));
}

// ── 10. hitungTotalSO: fisik & gudang dipisah ───────────────────────────
{
  const F = buatSandbox();
  const t = F.hitungTotalSO([
    { qty: 4, jenis: 'fisik', tanggal: '24/11/2026', timestamp: 1 },
    { qty: 3, jenis: 'gudang', tanggal: '24/11/2026', timestamp: 2 },
    { qty: 1, jenis: 'fisik', tanggal: '25/11/2026', timestamp: 3 },
  ]);
  cek('10. fisik pakai hari terakhir = 1', t.fisik === 1, JSON.stringify(t));
  cek('10b. gudang tetap 3', t.gudang === 3, JSON.stringify(t));
  cek('10c. total = 4', t.total === 4, JSON.stringify(t));
}

// ── 11. hitungTotalSO: aman untuk masukan aneh ──────────────────────────
{
  const F = buatSandbox();
  let aman = true;
  try {
    const a = F.hitungTotalSO([]);
    const b = F.hitungTotalSO(null);
    const c = F.hitungTotalSO(undefined);
    const d = F.hitungTotalSO([{ qty: 'x' }, null, {}]);
    if (a.total !== 0 || b.total !== 0 || c.total !== 0) aman = false;
    if (!Number.isFinite(d.total)) aman = false;
  } catch (e) { aman = false; console.log('     error: ' + e.message); }
  cek('11. masukan kosong/aneh tidak crash dan total 0', aman);
}

// ── 12. getBarangDiSemuaRak memakai aturan yang sama ────────────────────
{
  const F = buatSandbox();
  F.tambahInputSO('kefa', 'rak a', 'NN1', '111', 'Dimas', 10, 'fisik');
  // Hari berbeda: hitung ulang 8.
  const F2 = buatSandbox({ soShared: F.SO_SHARED, jam: 3 * SEHARI });
  F2.tambahInputSO('kefa', 'rak a', 'NN1', '111', 'Dimas', 8, 'fisik');
  const raks = F2.getBarangDiSemuaRak('kefa', 'NN1');
  cek('12. totalFisik pakai hitungan terakhir = 8', raks[0].totalFisik === 8, JSON.stringify(raks[0].totalFisik));
  cek('12b. semua entri tetap tersimpan (2)', raks[0].entries.length === 2, JSON.stringify(raks[0].entries.length));
  cek('12c. ditandai ada hitung ulang', raks[0].adaHitungUlang === true, JSON.stringify(raks[0].adaHitungUlang));
}

// ── 13. getSOGabunganData & getTotalBarangSemuaRak konsisten ────────────
{
  const F = buatSandbox();
  F.tambahInputSO('kefa', 'rak a', 'NN1', '111', 'Dimas', 10, 'fisik');
  F.tambahInputSO('kefa', 'rak a', 'NN2', '111', 'Dimas', 4, 'gudang');
  const F2 = buatSandbox({ soShared: F.SO_SHARED, jam: 2 * SEHARI });
  F2.tambahInputSO('kefa', 'rak a', 'NN1', '111', 'Dimas', 8, 'fisik');
  const gab = F2.getSOGabunganData('kefa');
  const tot = F2.getTotalBarangSemuaRak('kefa', 'NN1');
  cek('13. gabungan fisik NN1 = 8', gab.fisik.NN1 === 8, JSON.stringify(gab));
  cek('13b. gabungan gudang NN2 = 4', gab.gudang.NN2 === 4, JSON.stringify(gab));
  cek('13c. getTotalBarangSemuaRak sepakat = 8', tot.totalFisik === 8, JSON.stringify(tot.totalFisik));
  cek('13d. layar & rekap memakai angka sama', gab.fisik.NN1 === tot.totalFisik);
}

// ── 14. Entri baru menyimpan tanggal ────────────────────────────────────
{
  const F = buatSandbox();
  F.tambahInputSO('kefa', 'rak a', 'NN1', '111', 'Dimas', 5, 'fisik');
  const e = F.SO_SHARED.kefa.racks['rak a'].items.NN1.entries[0];
  cek('14. entri baru punya field tanggal', /^\d{2}\/\d{2}\/\d{4}$/.test(String(e.tanggal)), JSON.stringify(e));
  cek('14b. tanggal entri = tanggal hari ini', e.tanggal === F.getTanggalSlash(false), JSON.stringify(e.tanggal));
  cek('14c. jamInput tetap ada', /^\d{2}:\d{2}$/.test(String(e.jamInput)), JSON.stringify(e.jamInput));
  cek('14d. timestamp tetap ada', Number.isFinite(e.timestamp), JSON.stringify(e.timestamp));
}

// ── 15. tanggalEntri / jamEntri menurunkan dari timestamp ───────────────
{
  const F = buatSandbox();
  const ms = F.getJakartaDate().getTime();
  const eLama = { jamInput: '09:47', timestamp: ms }; // data lama: tanpa tanggal
  cek('15. entri lama: tanggal diturunkan dari timestamp',
    F.tanggalEntri(eLama) === F.formatTanggalDariMs(ms), `${F.tanggalEntri(eLama)}`);
  cek('15b. entri lama: jam diturunkan dari timestamp',
    F.jamEntri(eLama) === F.formatJamDariMs(ms), `${F.jamEntri(eLama)}`);
  cek('15c. tanggal entri baru dipakai apa adanya',
    F.tanggalEntri({ tanggal: '24/11/2026', timestamp: ms }) === '24/11/2026');
  // Entri tanpa timestamp -> jatuh ke jamInput.
  cek('15d. tanpa timestamp: jam jatuh ke jamInput', F.jamEntri({ jamInput: '09:47' }) === '09:47',
    `${F.jamEntri({ jamInput: '09:47' })}`);
  // Sufiks kotor dibersihkan.
  cek('15e. sufiks (updated) dibersihkan', F.jamEntri({ jamInput: '10:30 (updated)' }) === '10:30',
    `${F.jamEntri({ jamInput: '10:30 (updated)' })}`);
  cek('15f. sufiks (edited) dibersihkan', F.jamEntri({ jamInput: '10:30 (edited)' }) === '10:30',
    `${F.jamEntri({ jamInput: '10:30 (edited)' })}`);
  cek('15g. entri kosong tidak crash', F.jamEntri(null) === '' && F.tanggalEntri(null) === '',
    `${F.jamEntri(null)} / ${F.tanggalEntri(null)}`);
}

// ── 16. format tanggal & jam memakai WITA (bukan UTC server) ────────────
{
  const F = buatSandbox();
  // 24 Nov 2026 10:25 WITA = 24 Nov 2026 02:25 UTC
  const ms = Date.parse('2026-11-24T02:25:00Z');
  cek('16. tanggal WITA benar', F.formatTanggalDariMs(ms) === '24/11/2026', F.formatTanggalDariMs(ms));
  cek('16b. jam WITA benar', F.formatJamDariMs(ms) === '10:25', F.formatJamDariMs(ms));
  // 00:30 WITA tanggal 25 = 16:30 UTC tanggal 24 -> harus tetap 25/11
  const ms2 = Date.parse('2026-11-24T16:30:00Z');
  cek('16c. lewat tengah malam WITA tidak mundur sehari',
    F.formatTanggalDariMs(ms2) === '25/11/2026', F.formatTanggalDariMs(ms2));
  cek('16d. jam lewat tengah malam WITA = 00:30', F.formatJamDariMs(ms2) === '00:30', F.formatJamDariMs(ms2));
}

// ── 17. resetSOSharedToko mem-backup sebelum mengosongkan ───────────────
{
  const F = buatSandbox();
  F.tambahInputSO('kefa', 'rak a', 'NN1', '111', 'Dimas', 5, 'fisik');
  F.resetSOSharedToko('kefa');
  cek('17. reset manual mengosongkan data', F.SO_SHARED.kefa === undefined, JSON.stringify(F.SO_SHARED.kefa));
  cek('17b. reset manual mem-backup dulu',
    Array.isArray(F.STOCKOPNAME.kefa) && F.STOCKOPNAME.kefa.length === 1,
    JSON.stringify(F.STOCKOPNAME.kefa?.length));
  cek('17c. backup memuat entri',
    F.STOCKOPNAME.kefa?.[0]?.sharedData?.racks?.['rak a']?.items?.NN1?.entries?.length === 1);
}

// ── 18. Sesi baru setelah reset berumur 7 hari lagi ─────────────────────
{
  const F = buatSandbox();
  F.tambahInputSO('kefa', 'rak a', 'NN1', '111', 'Dimas', 5, 'fisik');
  F.resetSOSharedToko('kefa');
  const s = F.getSOShared('kefa');
  cek('18. setelah reset: data kosong', Object.keys(s.racks).length === 0);
  cek('18b. setelah reset: sesi 7 hari', s.sesiBerakhir - s.sesiMulai === SEMINGGU,
    `${s.sesiBerakhir - s.sesiMulai} ms`);
}

// ── 19. Sumber kode: reset harian sudah TIDAK ada lagi ──────────────────
{
  const badanGet = ambilFungsi('getSOShared');
  cek('19. getSOShared tidak lagi membandingkan tanggal untuk reset',
    !/tanggal\s*!==\s*tanggalHariIni/.test(badanGet),
    'masih ada pembanding tanggal harian');
  cek('19b. getSOShared memakai sesiBerakhir', /sesiBerakhir/.test(badanGet), 'sesiBerakhir tidak dipakai');
  cek('19c. konstanta SEMINGGU_MS ada di index.js', /SEMINGGU_MS\s*=/.test(SUMBER), 'konstanta tidak ditemukan');
  cek('19d. nilai konstanta = 7x24 jam',
    /SEMINGGU_MS\s*=\s*7\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(SUMBER),
    'nilai konstanta tidak sesuai');
}

console.log('');
console.log(`LULUS: ${lulus}   GAGAL: ${gagal}`);
process.exit(gagal === 0 ? 0 : 1);

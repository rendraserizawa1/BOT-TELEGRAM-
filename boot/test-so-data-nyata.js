// Uji dengan DATA PRODUKSI ASLI (salinan storage/so_shared.json.bak dari SRV KEFA).
// Membuktikan perbaikan bekerja pada data nyata, bukan data karangan.
'use strict';

const fs = require('fs');
const path = require('path');

const AKAR = path.join(__dirname, '..');
const SUMBER = fs.readFileSync(path.join(AKAR, 'index.js'), 'utf8');

// Pengenal literal regex: escapeMd() memuat /[...`...]/, sehingga pemindai
// harus tahu bahwa '/' di situ membuka regex, bukan komentar/template.
function posisiRegex(s, idx) {
  for (let j = idx - 1; j >= 0; j--) {
    const ch = s[j];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue;
    return '(,=:[!&|?{};+-*%<>~^'.includes(ch);
  }
  return true;
}

function ambil(src, nama) {
  const m = new RegExp(`function\\s+${nama}\\s*\\(`).exec(src);
  if (!m) throw new Error(`fungsi ${nama} tidak ada`);
  const awal = src.indexOf('{', m.index);
  let dalam = 0, i = awal, mode = null, kelasRegex = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (mode === null) {
      if (c === '/' && n === '/') { mode = '//'; i++; continue; }
      if (c === '/' && n === '*') { mode = '/*'; i++; continue; }
      if (c === '/' && posisiRegex(src, i)) { mode = 'regex'; kelasRegex = false; continue; }
      if (c === "'") { mode = "'"; continue; }
      if (c === '"') { mode = '"'; continue; }
      if (c === '`') { mode = '`'; continue; }
      if (c === '{') dalam++;
      else if (c === '}') { dalam--; if (dalam === 0) { i++; break; } }
      continue;
    }
    if (mode === '//') { if (c === '\n') mode = null; continue; }
    if (mode === '/*') { if (c === '*' && n === '/') { mode = null; i++; } continue; }
    if (mode === 'regex') {
      if (c === '\\') { i++; continue; }
      if (c === '[') { kelasRegex = true; continue; }
      if (c === ']') { kelasRegex = false; continue; }
      if (c === '/' && !kelasRegex) mode = null;
      continue;
    }
    if (c === '\\') { i++; continue; }
    if (c === mode) mode = null;
  }
  return src.slice(m.index, i);
}

const FNS = ['kunciPetugas', 'getBarangDiSemuaRak', 'getTotalBarangSemuaRak', 'formatInfoBarangDiRakLain', 'tampilkanBarangPilihan', 'escapeMd'];
const badan = FNS.map((f) => ambil(SUMBER, f)).join('\n\n');

const BERKAS = process.argv[2] || 'C:/Windows/Temp/so_shared.bak.json';

// Berkas ini adalah salinan data produksi dan TIDAK ikut di repo (berisi nama
// petugas asli). Di mesin yang tidak punya berkasnya (SRV/CI), tes ini harus
// LEWAT dengan sukses - bukan gagal - supaya tidak jadi alarm palsu.
if (!fs.existsSync(BERKAS)) {
  console.log('=== Uji data produksi: DILEWATI ===');
  console.log('  berkas tidak ada: ' + BERKAS);
  console.log('  (salin storage/so_shared.json.bak dari SRV KEFA untuk menjalankan)');
  process.exit(0);
}

const mentah = JSON.parse(fs.readFileSync(BERKAS, 'utf8'));

let lulus = 0, gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) { lulus++; console.log(`  PASS  ${nama}`); }
  else { gagal++; console.log(`  FAIL  ${nama}${detail ? ' -> ' + detail : ''}`); }
}

console.log('=== Uji dengan data PRODUKSI ASLI: ' + path.basename(BERKAS) + ' ===\n');

// Hitung dulu isi nyatanya.
const data = mentah.kefa;
const semuaEntri = [];
Object.entries(data.racks || {}).forEach(([rak, rd]) => {
  Object.entries(rd.items || {}).forEach(([kode, id]) => {
    id.entries.forEach((e) => semuaEntri.push({ rak, kode, ...e }));
  });
});
const userIdUnik = new Set(semuaEntri.map((e) => String(e.userId)));
const namaUnik = new Set(semuaEntri.map((e) => e.namaPetugas));
const bertanda = semuaEntri.filter((e) => /\((updated|edited)\)/i.test(String(e.jamInput || '')));

console.log(`  Isi data: ${semuaEntri.length} entri, ${userIdUnik.size} userId, ${namaUnik.size} nama petugas`);
console.log(`  Nama petugas: ${[...namaUnik].map((n) => JSON.stringify(n)).join(', ')}`);
console.log(`  Entri bertanda (updated/edited): ${bertanda.length}`);
console.log('');

cek('prasyarat: hanya 1 userId (bukti akun Telegram dipakai bersama)', userIdUnik.size === 1, `userId=${[...userIdUnik].join(',')}`);
cek('prasyarat: lebih dari 1 nama petugas', namaUnik.size > 1, `${namaUnik.size} nama`);

// ── Jalankan fungsi asli terhadap data produksi ──────────────────────────
function buatFungsi(so) {
  return new Function('SO', `
    const getSOShared = (t) => SO[t];
    const GARIS_TEBAL = '━━━━━━━━━━━━━━━━━━━━';
    ${badan}
    return { ${FNS.join(', ')} };
  `)(so);
}

const F = buatFungsi(mentah);

// ── Cari barang yang dihitung >1 petugas ATAU bertanda, di rak yang sama ─
const perItem = new Map();
semuaEntri.forEach((e) => {
  const k = e.rak + '\u0000' + e.kode;
  if (!perItem.has(k)) perItem.set(k, []);
  perItem.get(k).push(e);
});

// Skenario nyata: MAS ANDRI membuka barang yang dihitung ibu fitri.
const ujiNyata = semuaEntri.filter((e) => /fitri/i.test(e.namaPetugas) && !/\((updated|edited)\)/i.test(e.jamInput));
console.log(`\n  Barang yang dihitung "ibu fitri dan intan" (tanpa penanda): ${ujiNyata.length}`);

if (ujiNyata.length) {
  const sample = ujiNyata[0];
  const hasil = F.formatInfoBarangDiRakLain('kefa', sample.kode, sample.rak, String(sample.userId), 'MAS ANDRI');
  console.log(`\n  Contoh nyata: ${sample.kode} di "${sample.rak}" (oleh ${sample.namaPetugas} jam ${sample.jamInput})`);
  console.log('  Yang dilihat MAS ANDRI:');
  (hasil || '(KOSONG)').split('\n').filter((l) => l.trim()).forEach((l) => console.log('    ' + l));
  cek('data nyata: MAS ANDRI melihat blok petugas', hasil !== '', '(kosong)');
  cek('data nyata: nama ibu fitri tampil', hasil.includes('ibu fitri dan intan') || hasil.includes('Ibu fitri dan intan'), hasil);
  cek('data nyata: jam hitung tampil', hasil.includes(sample.jamInput), hasil);

  // Kebalikannya: ibu fitri sendiri HARUS tetap melihat riwayatnya sendiri,
  // lengkap dengan nama + jam, dan entrinya ditandai "(Anda)".
  // Dulu blok ini disembunyikan untuk pemilik entri, sehingga layar
  // "Barang ditemukan!" tidak memuat nama petugas & jam sama sekali.
  const hasilSendiri = F.formatInfoBarangDiRakLain('kefa', sample.kode, sample.rak, String(sample.userId), sample.namaPetugas);
  console.log('  Yang dilihat pemilik entri (ibu fitri) saat membuka barang yang sama:');
  (hasilSendiri || '(KOSONG)').split('\n').filter((l) => l.trim()).forEach((l) => console.log('    ' + l));
  cek('data nyata: petugas sendiri TETAP melihat riwayatnya', hasilSendiri !== '', '(kosong)');
  cek('data nyata: nama petugas sendiri tetap tampil',
    hasilSendiri.includes(sample.namaPetugas), hasilSendiri);
  cek('data nyata: jam hitung sendiri tetap tampil',
    hasilSendiri.includes(sample.jamInput), hasilSendiri);
  cek('data nyata: entri sendiri ditandai (Anda)', /\(Anda\)/i.test(hasilSendiri), hasilSendiri);
}

// ── Entri bertanda harus diberi peringatan ───────────────────────────────
if (bertanda.length) {
  const b = bertanda[0];
  const hasilB = F.formatInfoBarangDiRakLain('kefa', b.kode, b.rak, String(b.userId), 'MAS ANDRI');
  console.log(`\n  Contoh entri bertanda: ${b.kode} jam="${b.jamInput}" qty=${b.qty}`);
  cek('data nyata: entri bertanda diberi peringatan data lama', /data lama/i.test(hasilB), hasilB || '(kosong)');
  cek('data nyata: peringatan menyebut tercampur', /tercampur/i.test(hasilB));
}

// ── Semua item: tidak boleh ada yang crash ───────────────────────────────
let crash = 0;
perItem.forEach((entri, k) => {
  const [rak, kode] = k.split('\u0000');
  try {
    F.formatInfoBarangDiRakLain('kefa', kode, rak, String(entri[0].userId), 'PENGUJI');
  } catch (e) { crash++; }
});
cek(`semua ${perItem.size} item diproses tanpa crash`, crash === 0, `${crash} crash`);

// ── Kunci petugas: nama yang beda kapitalisasi HARUS jadi satu kunci ─────
// Data produksi memuat "ibu fitri dan intan" DAN "Ibu fitri dan intan".
// Kalau keduanya menghasilkan kunci sama, satu orang tidak terpecah.
const petaKunci = new Map();
namaUnik.forEach((n) => {
  const k = F.kunciPetugas(n);
  if (!petaKunci.has(k)) petaKunci.set(k, []);
  petaKunci.get(k).push(n);
});
const kunciFitri = petaKunci.get('ibu fitri dan intan') || [];
cek('nama beda kapitalisasi menyatu jadi satu kunci', kunciFitri.length === 2,
  `kunci "ibu fitri dan intan" berisi: ${JSON.stringify(kunciFitri)}`);
cek('nama orang berbeda tetap terpisah', petaKunci.size === 2,
  `jumlah kunci=${petaKunci.size} -> ${JSON.stringify([...petaKunci.keys()])}`);
cek('kunciPetugas merapikan spasi berlebih', F.kunciPetugas('  MAS   ANDRI  ') === 'mas andri',
  JSON.stringify(F.kunciPetugas('  MAS   ANDRI  ')));

console.log('\n────────────────────────────────────────────');
console.log(`  LULUS: ${lulus}   GAGAL: ${gagal}`);
console.log('────────────────────────────────────────────');
process.exit(gagal === 0 ? 0 : 1);

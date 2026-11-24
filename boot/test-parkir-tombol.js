// test-parkir-tombol.js
// Tombol isian parkir: "Tanpa Parkir" & "Parkir 0 0" harus bisa DITEKAN,
// tidak lagi wajib mengetik `parkir batal` / `parkir 0 0` di keyboard.
//
// Kenapa tes ini ada (permintaan pemilik 24 Nov 2026):
//   "jika tidak ingin menampilkan parkir tidak perlu harus ketik parkir batal
//    manual tulis bisa ada tombol menu parkir batal nya untuk tinggal ditekan"
//
// Yang diuji BUKAN hanya teks tombolnya, tetapi perilakunya:
//   1. callback_data tiap tombol sah & bisa diurai kembali
//   2. handler `parkir:` benar-benar memanggil tampilkanLaporanKasir dengan
//      isian yang tepat (skip / 0 0)
//   3. tanggal & toko diambil dari TOMBOL, bukan dari sesi yang mungkin basi
//   4. pendingParkir dibersihkan supaya bot tidak menunggu isian manual lagi
//   5. tombol kedaluwarsa / aksi tak dikenal tidak membuat bot diam
//
// Tes ini membaca index.js lalu menjalankan fungsi & handler aslinya.

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SUMBER = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');

let lulus = 0;
let gagal = 0;
const cek = (nama, syarat, detail = '') => {
  if (syarat) {
    lulus++;
    console.log('  PASS  ' + nama);
  } else {
    gagal++;
    console.log('  FAIL  ' + nama + (detail ? ' -> ' + detail : ''));
  }
};

// ───────────── Ambil fungsi asli dari index.js ─────────────
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
  if (!m) throw new Error('fungsi tidak ada: ' + nama);
  let awalKata = m.index;
  if (/async\s$/.test(SUMBER.slice(Math.max(0, m.index - 6), m.index))) awalKata = m.index - 6;
  const awal = SUMBER.indexOf('{', m.index);
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
      if (c === "'" || c === '"' || c === '`') { mode = c; continue; }
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
      if (c === '/' && !kelasRegex) mode = null;
      continue;
    }
    if (c === '\\') { i++; continue; }
    if (c === mode) mode = null;
  }
  return SUMBER.slice(awalKata, i);
}

// ───────────── Sandbox: jalankan kbIsianParkir asli ─────────────
function buatSandbox() {
  const src = `
    ${ambilFungsi('ymdLokal')}
    ${ambilFungsi('kbIsianParkir')}
    return { kbIsianParkir, ymdLokal };
  `;
  return new Function(src)();
}

console.log('=== Uji tombol isian parkir ===\n');

// ── 1. Fungsi tombol ada & menghasilkan tombol yang bisa ditekan ──────────
{
  const F = buatSandbox();
  const kb = F.kbIsianParkir('2026-11-24', 'cp');
  const semua = kb.inline_keyboard.flat();
  const teks = semua.map((b) => b.text);
  const data = semua.map((b) => b.callback_data);

  cek('1. ada tombol "Tanpa Parkir"', teks.some((t) => /Tanpa Parkir/i.test(t)), teks.join(' | '));
  cek('1b. ada tombol "Parkir 0 0"', teks.some((t) => /Parkir 0 0/.test(t)), teks.join(' | '));
  cek('1c. tombol Menu Utama tetap ada', data.includes('menu:main'), data.join(' | '));
  cek('1d. tombol Hari Ini & Kemarin tetap ada (jangan hilangkan fitur lama)',
    data.some((d) => d === 'jualkasir:' + F.ymdLokal(0)) && data.some((d) => d === 'jualkasir:' + F.ymdLokal(-1)),
    data.join(' | '));

  // callback_data Telegram maksimum 64 byte.
  const kepanjangan = data.filter((d) => Buffer.byteLength(d, 'utf8') > 64);
  cek('1e. semua callback_data <= 64 byte', kepanjangan.length === 0, kepanjangan.join(' | '));
}

// ── 2. callback_data bisa diurai kembali (round-trip) ─────────────────────
{
  const F = buatSandbox();
  const kb = F.kbIsianParkir('2026-11-24', 'kefa');
  const tombolSkip = kb.inline_keyboard.flat().find((b) => /Tanpa Parkir/i.test(b.text));
  const tombolNol = kb.inline_keyboard.flat().find((b) => /Parkir 0 0/.test(b.text));

  const urai = (d) => {
    const bagian = d.split(':');
    return { aksi: bagian[1], toko: bagian[2], ymd: bagian[3] };
  };
  const s = urai(tombolSkip.callback_data);
  const n = urai(tombolNol.callback_data);

  cek('2. tombol Tanpa Parkir -> aksi skip', s.aksi === 'skip', tombolSkip.callback_data);
  cek('2b. tombol Parkir 0 0 -> aksi nol', n.aksi === 'nol', tombolNol.callback_data);
  cek('2c. toko ikut terbawa', s.toko === 'kefa' && n.toko === 'kefa', s.toko + '/' + n.toko);
  cek('2d. tanggal ikut terbawa', s.ymd === '2026-11-24' && n.ymd === '2026-11-24', s.ymd + '/' + n.ymd);
  cek('2e. tanggal berbentuk YYYY-MM-DD yang sah', /^\d{4}-\d{2}-\d{2}$/.test(s.ymd), s.ymd);
}

// ── 3. Handler `parkir:` benar-benar memanggil laporan dengan isian tepat ──
// Handler diambil dari index.js apa adanya, lalu dijalankan dengan dependensi
// tiruan supaya bisa diperiksa argumen yang dikirim.
{
  const badanHandler = (() => {
    const tanda = "if (data.startsWith('parkir:')) {";
    const i = SUMBER.indexOf(tanda);
    if (i === -1) return null;
    // Cocokkan kurawal dari '{' pertama sampai seimbang, supaya blok utuh
    // (termasuk `return kirim(...)` yang memuat objek bertingkat).
    const awal = SUMBER.indexOf('{', i);
    let dalam = 0;
    let mode = null;
    let j = awal;
    for (; j < SUMBER.length; j++) {
      const c = SUMBER[j];
      const next = SUMBER[j + 1];
      if (mode === null) {
        if (c === '/' && next === '/') { mode = '//'; j++; continue; }
        if (c === '/' && next === '*') { mode = '/*'; j++; continue; }
        if (c === "'" || c === '"' || c === '`') { mode = c; continue; }
        if (c === '{') dalam++;
        else if (c === '}') { dalam--; if (dalam === 0) { j++; break; } }
        continue;
      }
      if (mode === '//') { if (c === '\n') mode = null; continue; }
      if (mode === '/*') { if (c === '*' && next === '/') { mode = null; j++; } continue; }
      if (c === '\\') { j++; continue; }
      if (c === mode) mode = null;
    }
    return SUMBER.slice(i, j);
  })();

  cek('3. handler parkir: ditemukan di index.js', !!badanHandler);

  if (badanHandler) {
    const jalankan = (data, opsi = {}) => {
      const panggilan = [];
      const sesi = [];
      const src = `
        const data = arguments[0];
        const userId = '42';
        const chatId = '99';
        const bisaAksesLaporan = () => arguments[1].akses;
        const updateSesi = (uid, patch) => arguments[1].sesi.push({ uid, patch });
        const tampilkanLaporanKasir = (...a) => { arguments[1].panggilan.push(a); return 'OK-LAPORAN'; };
        const kbMainMenu = () => ({ inline_keyboard: [] });
        const kirim = (cid, teks, opt) => { arguments[1].panggilan.push(['kirim', cid, teks]); return 'OK-KIRIM'; };
        // Dibungkus fungsi: badan handler memakai \`return\`, yang akan keluar dari
        // new Function dan membuat hasilnya undefined bila tidak dibungkus.
        (function () {
          ${badanHandler}
        })();
        return { panggilan: arguments[1].panggilan, sesi: arguments[1].sesi };
      `;
      return new Function(src)(data, { panggilan, sesi, akses: opsi.akses !== false });
    };

    // 3a. Tombol "Tanpa Parkir"
    {
      const h = jalankan('parkir:skip:kefa:2026-11-24');
      const lap = h.panggilan.find((p) => Array.isArray(p) && p.length === 5);
      cek('3a. Tanpa Parkir memanggil laporan', !!lap, JSON.stringify(h.panggilan));
      cek('3b. isian = { skip: true }', lap && lap[3] && lap[3].skip === true, JSON.stringify(lap && lap[3]));
      cek('3c. tanggal dari TOMBOL dipakai', lap && lap[2] === '2026-11-24', lap && lap[2]);
      cek('3d. toko dari TOMBOL dipakai', lap && lap[4] === 'kefa', lap && lap[4]);
      cek('3e. pendingParkir dibersihkan', h.sesi.some((s) => s.patch && s.patch.pendingParkir === null),
        JSON.stringify(h.sesi));
    }

    // 3f. Tombol "Parkir 0 0"
    {
      const h = jalankan('parkir:nol:cp:2026-11-23');
      const lap = h.panggilan.find((p) => Array.isArray(p) && p.length === 5);
      cek('3f. Parkir 0 0 memanggil laporan', !!lap, JSON.stringify(h.panggilan));
      cek('3g. isian = { komputer: 0, luar: 0 }',
        lap && lap[3] && lap[3].komputer === 0 && lap[3].luar === 0, JSON.stringify(lap && lap[3]));
      cek('3h. TIDAK dianggap skip', lap && lap[3] && !lap[3].skip, JSON.stringify(lap && lap[3]));
      cek('3i. tanggal & toko dari tombol', lap && lap[2] === '2026-11-23' && lap[4] === 'cp',
        (lap && lap[2]) + '/' + (lap && lap[4]));
    }

    // 3j. Tanggal rusak / tombol kedaluwarsa -> tidak diam, tidak generate salah
    {
      const h = jalankan('parkir:skip:cp:');
      const lap = h.panggilan.find((p) => Array.isArray(p) && p.length === 5);
      const pesan = h.panggilan.find((p) => p[0] === 'kirim');
      cek('3j. tanggal kosong TIDAK memanggil laporan', !lap, JSON.stringify(h.panggilan));
      cek('3k. tanggal kosong memberi pesan ke pengguna', !!pesan && /kedaluwarsa/i.test(pesan[2]),
        pesan && pesan[2]);
    }

    // 3l. Aksi tak dikenal
    {
      const h = jalankan('parkir:ngawur:cp:2026-11-24');
      const lap = h.panggilan.find((p) => Array.isArray(p) && p.length === 5);
      const pesan = h.panggilan.find((p) => p[0] === 'kirim');
      cek('3l. aksi tak dikenal TIDAK memanggil laporan', !lap, JSON.stringify(h.panggilan));
      cek('3m. aksi tak dikenal memberi pesan', !!pesan && /tidak dikenal/i.test(pesan[2]), pesan && pesan[2]);
    }

    // 3n. Tanpa akses laporan -> ditolak, tidak generate apa pun
    {
      const h = jalankan('parkir:skip:cp:2026-11-24', { akses: false });
      const lap = h.panggilan.find((p) => Array.isArray(p) && p.length === 5);
      const pesan = h.panggilan.find((p) => p[0] === 'kirim');
      cek('3n. tanpa akses: laporan TIDAK digenerate', !lap, JSON.stringify(h.panggilan));
      cek('3o. tanpa akses: ada pesan ditolak', !!pesan && /Akses ditolak/i.test(pesan[2]), pesan && pesan[2]);
    }
  }
}

// ── 4. Pesan isian parkir memakai tombol, bukan hanya instruksi ketik ─────
{
  const i = SUMBER.indexOf('LAPORAN PARKIR');
  const blok = SUMBER.slice(i, i + 1400);
  cek('4. pesan isian memakai kbIsianParkir', /kbIsianParkir\(ymd, toko\)/.test(blok),
    'reply_markup bukan kbIsianParkir');
  cek('4b. pesan menyebut tombol "Tanpa Parkir"', /Tanpa Parkir/.test(blok), 'tidak menyebut tombol');
  cek('4c. pesan menyebut tombol "Parkir 0 0"', /Parkir 0 0/.test(blok), 'tidak menyebut tombol');
  cek('4d. instruksi ketik manual TETAP ada (cadangan)',
    /parkir \[di komputer\] \[stor luar\]/.test(blok), 'instruksi manual hilang');
}

// ── 5. Pesan "format belum benar" juga memberi tombol ─────────────────────
{
  const i = SUMBER.indexOf('Format parkir belum benar');
  const blok = SUMBER.slice(Math.max(0, i - 200), i + 700);
  cek('5. pesan format salah memakai kbIsianParkir', /kbIsianParkir\(pp\.ymd, pp\.toko\)/.test(blok),
    'tanpa tombol -> petugas mentok');
  cek('5b. pesan format salah tetap Markdown', /parse_mode: 'Markdown'/.test(blok), 'parse_mode hilang');
}

// ── 6. Semua toko mendapat tombol yang benar (cp/nk/kefa) ────────────────
{
  const F = buatSandbox();
  for (const [toko, pref] of [['cp', 'jualkasir:'], ['nk', 'jualkasirnk:'], ['kefa', 'jualkasirkefa:']]) {
    const kb = F.kbIsianParkir('2026-11-24', toko);
    const data = kb.inline_keyboard.flat().map((b) => b.callback_data);
    cek(`6. ${toko}: tombol parkir membawa toko yang benar`,
      data.some((d) => d === `parkir:skip:${toko}:2026-11-24`), data.join(' | '));
    cek(`6b. ${toko}: tombol Hari Ini memakai prefix ${pref}`,
      data.some((d) => d === pref + F.ymdLokal(0)), data.join(' | '));
  }
}

// ── 7. Sumber kode: tidak ada lagi satu-satunya jalan lewat ketik ────────
{
  cek('7. kbIsianParkir didefinisikan di index.js', /function kbIsianParkir\(/.test(SUMBER), 'tidak ada');
  cek('7b. handler parkir: ada di index.js', /data\.startsWith\('parkir:'\)/.test(SUMBER), 'tidak ada');
  cek('7c. handler berada di dalam callback_query (setelah jualkasirkefa:)',
    SUMBER.indexOf("data.startsWith('parkir:')") > SUMBER.indexOf("data.startsWith('jualkasirkefa:')"),
    'urutan handler salah');
}

console.log('');
console.log(`LULUS: ${lulus}   GAGAL: ${gagal}`);
process.exit(gagal === 0 ? 0 : 1);

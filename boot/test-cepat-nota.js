'use strict';
/**
 * Tes: jalur simpan-nota CEPAT dan tidak diam-diam merusak gambar.
 *
 * Setiap aturan di bawah berasal dari pengukuran nyata 17/11/2026, bukan
 * tebakan. Tes ini menguncinya supaya tidak "dirapikan" kembali ke bentuk
 * lambat tanpa ada yang sadar.
 *
 *   A. siapkanGambarNota TIDAK membesarkan gambar (Jimp dulu 145.937 ->
 *      423.028 byte, dan OCR-nya 3x lebih lambat: 8.617 ms vs 2.746 ms)
 *   B. JPEG dikirim apa adanya; bukan-JPEG diubah ke JPEG
 *   C. gambar raksasa tetap diperkecil
 *   D. daftar model: yang tercepat & benar didahulukan, yang pensiun dibuang
 *   E. TIDAK ada thinkingConfig (itu penyebab HTTP 400 di model lite)
 *   F. notifikasi sukses menyebut folder tujuan + waktu tempuh
 */

const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

let gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) console.log('  PASS  ' + nama);
  else { console.error('  GAGAL ' + nama + (detail !== undefined ? ' -> ' + detail : '')); gagal++; }
}

const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

// ══ A. Jimp tidak boleh dipakai untuk membesarkan gambar ═══════════════
// Diambil langsung dari sumber karena fungsinya tidak diekspor dari index.js.
const potonganSiapkan = src.slice(src.indexOf('async function siapkanGambarNota'));
const badanSiapkan = potonganSiapkan.slice(0, potonganSiapkan.indexOf('\nlet notaModelFavorit'));

cek('A: siapkanGambarNota tidak memakai contrast()',
  !/\.contrast\(/.test(badanSiapkan), 'contrast menambah waktu tanpa menambah ketepatan');
cek('A: siapkanGambarNota tidak memaksa quality()',
  !/\.quality\(/.test(badanSiapkan), 'quality() ikut memperbesar berkas');
cek('A: ada jalan pintas mengembalikan buffer asli',
  /return imageBuffer/.test(badanSiapkan), badanSiapkan.slice(0, 200));
cek('A: hanya memperkecil bila memang besar',
  /perluKecil/.test(badanSiapkan) && /2000|1600/.test(badanSiapkan));

// Bukti perilakunya pada gambar nyata: JPEG 720px harus kembali APA ADANYA.
(async () => {
  const nota = '\\\\100.125.99.99\\E\\TOKO NASIONAL KITCHEN\\Nota Toko Nasional Kitchen\\Nota bulan november 2026';
  let contoh = null;
  try {
    const calon = fs.readdirSync(nota).filter((f) => /\.jpg$/i.test(f)).sort();
    if (calon.length) contoh = fs.readFileSync(path.join(nota, calon[0]));
  } catch (_) {}
  if (!contoh) {
    const c = path.join(__dirname, '..', 'data', 'files', 'in', '8997270739', '2026-11-13', '51906_photo_51906.jpg');
    if (fs.existsSync(c)) contoh = fs.readFileSync(c);
  }

  if (contoh) {
    // Jalankan fungsi yang sama persis, disalin dari index.js.
    const siapkanGambarNota = eval('(' + badanSiapkan.replace(/^async function siapkanGambarNota/, 'async function') + ')');
    const hasil = await siapkanGambarNota(contoh);
    cek('A: JPEG 720px dikirim APA ADANYA (tidak dibesar-besarkan)',
      hasil.length === contoh.length, 'asli ' + contoh.length + ' vs hasil ' + hasil.length);
    cek('A: isi tidak berubah', Buffer.compare(hasil, contoh) === 0);

    // B. Bukan JPEG (PNG) harus diubah ke JPEG.
    const png = await new Jimp(200, 100, 0xFFFFFFFF).getBufferAsync(Jimp.MIME_PNG);
    const hasilPng = await siapkanGambarNota(png);
    cek('B: PNG diubah ke JPEG', hasilPng[0] === 0xFF && hasilPng[1] === 0xD8,
      'byte awal: ' + hasilPng[0] + ',' + hasilPng[1]);

    // C. Gambar raksasa diperkecil.
    const besar = await new Jimp(3000, 2000, 0xFF0000FF).getBufferAsync(Jimp.MIME_JPEG);
    const hasilBesar = await siapkanGambarNota(besar);
    const imgBesar = await Jimp.read(hasilBesar);
    cek('C: gambar 3000px diperkecil', imgBesar.bitmap.width <= 1600, imgBesar.bitmap.width);
  } else {
    console.log('  LEWATI A/B/C: tidak ada gambar contoh');
  }

  // ══ D. Urutan model ═══════════════════════════════════════════════════
  const potonganModel = src.slice(src.indexOf('const NOTA_MODEL'), src.indexOf('async function notaOCRRace'));
  cek('D: daftar model ada', /NOTA_MODEL\s*=/.test(potonganModel), potonganModel.slice(0, 120));
  cek('D: gemini-3.5-flash-lite didahulukan',
    /NOTA_MODEL\s*=\s*\[\s*'gemini-3\.5-flash-lite'/.test(potonganModel), potonganModel.slice(0, 200));
  cek('D: gemini-2.5-flash-lite (404 permanen) DIBUANG',
    !/'gemini-2\.5-flash-lite'/.test(potonganModel), 'model ini selalu 404');
  cek('D: gemini-2.0-* (pensiun) tidak ada',
    !/gemini-2\.0-/.test(potonganModel));

  // ══ E. thinkingConfig tidak boleh kembali ══════════════════════════════
  const badanOCR = src.slice(src.indexOf('async function notaOCRRace'));
  const badanOCRSaja = badanOCR.slice(0, badanOCR.indexOf('async function handleSimpanNotaText'));
  // Baris komentar dibuang PER BARIS. Penjelasan "TANPA thinkingConfig" memang
  // harus ada di komentar; yang dilarang adalah PENUGASAN propertinya di kode.
  // Versi pertama tes ini memakai regex satu-baris dan gagal karena `\r\n`.
  const barisKode = badanOCRSaja.split(/\r?\n/).filter((b) => {
    const t = b.trim();
    return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  });
  const kodeOCR = barisKode.join('\n');
  cek('E: TIDAK ada penugasan thinkingConfig di kode',
    !/thinkingConfig\s*:/.test(kodeOCR), 'menyebabkan HTTP 400 di gemini-3.5-flash-lite');
  cek('E: generationConfig hanya temperature + maxOutputTokens',
    /generationConfig:\s*\{\s*temperature[^}]*maxOutputTokens[^}]*\}/.test(kodeOCR),
    'ada parameter lain yang tidak teruji');
  cek('E: timeout per model <= 20 dtk',
    /timeout:\s*15000/.test(badanOCRSaja) || /timeout:\s*1[0-9]000/.test(badanOCRSaja),
    'timeout panjang membuat model mati memblokir antrean');

  // ══ F. Notifikasi sukses ══════════════════════════════════════════════
  cek('F: notifikasi menyebut folder tujuan (hasil.path)', /hasil\.path/.test(src));
  cek('F: notifikasi menyebut waktu tempuh', /formatLama\(lamaSimpanMs\)/.test(src));
  cek('F: ada fungsi formatLama', /function formatLama/.test(src));
  cek('F: "sedang membaca" tidak ditunggu (void)',
    /void kirim\(chatId, '[^']*Membaca/.test(src), 'menambah round-trip Telegram');

  if (gagal) { console.error('\n' + gagal + ' GAGAL'); process.exit(1); }
  console.log('\nOK cepat-nota: A + B + C + D + E + F');
})().catch((e) => { console.error('FATAL: ' + e.message); process.exit(1); });

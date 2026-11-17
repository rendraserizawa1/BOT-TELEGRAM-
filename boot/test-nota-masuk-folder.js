'use strict';
/**
 * Tes: notifikasi "berhasil masuk folder" + pembacaan dimensi tanpa Jimp.
 *
 * Setiap aturan di bawah berasal dari pengukuran nyata 17/11/2026:
 *
 *   A. dimensiJpeg() membaca lebar/tinggi dari header, 0 ms, dan hasilnya
 *      SAMA PERSIS dengan Jimp (15/15). Jalur nota tidak boleh lagi memanggil
 *      Jimp.read() hanya untuk membaca lebar (216 ms terbuang per nota).
 *   B. Catatan antrean menyimpan chatId pengirim, supaya saat nota mendarat
 *      di share pengirimnya bisa diberi tahu.
 *   C. /api/ipos/nota/selesai MENGIRIM notifikasi "masuk folder" ke pengirim.
 *   D. Jeda penjemput 2000 ms (bukan 5000 ms).
 *   E. Kegagalan notifikasi TIDAK boleh menggagalkan pemindahan nota.
 *
 * Jalankan: node boot/test-nota-masuk-folder.js
 */
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

let gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) console.log('  PASS  ' + nama);
  else { console.error('  GAGAL ' + nama + (detail !== undefined ? ' -> ' + detail : '')); gagal++; }
}

const srcIndex = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const srcNota = fs.readFileSync(path.join(__dirname, 'nota-simpan.js'), 'utf8');
const srcAgen = fs.readFileSync(path.join(__dirname, 'push-agen.js'), 'utf8');

// ══ A. dimensiJpeg ══════════════════════════════════════════════════════
const awalDim = srcIndex.indexOf('function dimensiJpeg');
const akhirDim = srcIndex.indexOf('async function siapkanGambarNota');
cek('A: fungsi dimensiJpeg ada', awalDim > 0 && akhirDim > awalDim);

const badanDim = srcIndex.slice(awalDim, akhirDim);
const dimensiJpeg = eval('(' + badanDim.replace(/^function dimensiJpeg/, 'function') + ')');

(async () => {
  // A1. Ketepatan pada JPEG nyata: harus sama dengan Jimp.
  let contoh = [];
  try {
    const share = '\\\\100.125.99.99\\E\\TOKO NASIONAL KITCHEN\\Nota Toko Nasional Kitchen\\Nota bulan november 2026';
    contoh = fs.readdirSync(share).filter((f) => /\.jpg$/i.test(f)).slice(0, 6)
      .map((f) => fs.readFileSync(path.join(share, f)));
  } catch (_) { /* pakai contoh buatan di bawah */ }

  if (!contoh.length) {
    // Cadangan: gambar buatan sendiri (tidak butuh share).
    contoh = [
      await new Jimp(640, 480, 0xFF0000FF).getBufferAsync(Jimp.MIME_JPEG),
      await new Jimp(1280, 720, 0x00FF00FF).getBufferAsync(Jimp.MIME_JPEG),
      await new Jimp(3000, 2000, 0x0000FFFF).getBufferAsync(Jimp.MIME_JPEG),
    ];
    console.log('  (memakai gambar buatan: share tidak terjangkau)');
  }

  let cocok = 0, total = 0;
  for (const buf of contoh) {
    const img = await Jimp.read(buf);
    const d = dimensiJpeg(buf);
    total++;
    if (d && d.lebar === img.bitmap.width && d.tinggi === img.bitmap.height) cocok++;
    else console.log('     BEDA: header=' + JSON.stringify(d) + ' jimp=' + img.bitmap.width + 'x' + img.bitmap.height);
  }
  cek('A: dimensiJpeg sama persis dengan Jimp pada ' + total + ' gambar', cocok === total, cocok + '/' + total);

  // A2. Bukan JPEG harus mengembalikan null (pemanggil lalu pakai Jimp).
  const png = await new Jimp(100, 100, 0xFFFFFFFF).getBufferAsync(Jimp.MIME_PNG);
  cek('A: PNG mengembalikan null (jatuh ke Jimp)', dimensiJpeg(png) === null);
  cek('A: buffer kosong mengembalikan null', dimensiJpeg(Buffer.alloc(0)) === null);
  cek('A: bukan buffer mengembalikan null', dimensiJpeg('bukan buffer') === null);

  // A3. Jalur nota TIDAK boleh memanggil Jimp.read() untuk JPEG wajar.
  const badanSiapkan = srcIndex.slice(akhirDim, srcIndex.indexOf('\nlet notaModelFavorit'));
  cek('A: siapkanGambarNota memakai dimensiJpeg', /dimensiJpeg\(imageBuffer\)/.test(badanSiapkan));
  cek('A: ada jalan pintas "kirim apa adanya" SEBELUM Jimp.read',
    badanSiapkan.indexOf('return imageBuffer') < badanSiapkan.indexOf('Jimp.read'),
    'urutan salah: Jimp.read dipanggil lebih dulu, 216 ms terbuang');
  cek('A: Jimp hanya dipakai untuk > 2000 px / non-JPEG',
    /lebar <= 2000/.test(badanSiapkan) || /lebar > 2000/.test(badanSiapkan));

  // Bukti perilaku: JPEG 720px harus kembali APA ADANYA.
  if (contoh.length) {
    const siapkanGambarNota = eval('(' + badanSiapkan
      .replace(/^\/\*\*[\s\S]*?\*\/\s*/, '')
      .replace(/^async function siapkanGambarNota/, 'async function') + ')');
    const kecil = await new Jimp(720, 1280, 0x888888FF).getBufferAsync(Jimp.MIME_JPEG);
    const hasil = await siapkanGambarNota(kecil);
    cek('A: JPEG 720px dikembalikan apa adanya (identik)', Buffer.compare(hasil, kecil) === 0);
  }

  // ══ B. Antrean menyimpan chatId ═══════════════════════════════════════
  cek('B: simpanKeAntrean menerima chatId',
    /function simpanKeAntrean\([^)]*chatId/.test(srcNota), 'tanpa chatId, pengirim tak bisa diberi tahu');
  cek('B: chatId ditulis ke catatan samping', /chatId: chatId == null/.test(srcNota));
  cek('B: chatId disimpan sebagai string (bukan Number)',
    /String\(chatId\)/.test(srcNota), 'chatId besar bisa dibulatkan dan salah orang');
  cek('B: pemanggil mengirim chatId',
    /simpanKeAntrean\(folderAntrean, namaFile, imageBuffer, hasil\.alasanShare, folderShare, chatId\)/.test(srcIndex));

  // ══ C. hapusDariAntrean mengembalikan meta ═══════════════════════════
  cek('C: hapusDariAntrean mengembalikan meta', /return \{ ok: true, meta: meta \|\| null \}/.test(srcNota));
  cek('C: meta dibaca SEBELUM berkas dihapus',
    srcNota.indexOf('const meta = bacaMeta') < srcNota.indexOf('fsAsli.unlinkSync(path.join(folderAntrean, asli))'),
    'meta dibaca setelah hapus = selalu null');

  // ══ D. Endpoint mengirim notifikasi ══════════════════════════════════
  const awalSelesai = srcIndex.indexOf("webApp.post('/api/ipos/nota/selesai'");
  const akhirSelesai = srcIndex.indexOf('webApp.use(session(', awalSelesai);
  const badanSelesai = srcIndex.slice(awalSelesai, akhirSelesai);

  cek('D: endpoint mengirim pesan ke pengirim', /bot\.sendMessage\(chatTujuan/.test(badanSelesai));
  cek('D: pesan menyebut "MASUK FOLDER"', /NOTA BERHASIL MASUK FOLDER/.test(badanSelesai));
  cek('D: pesan menyebut nama folder tujuan', /folderTujuan/.test(badanSelesai));
  cek('D: pesan menyebut waktu tempuh', /formatLama\(umurMs\)/.test(badanSelesai));
  cek('D: res.json dikirim SEBELUM notifikasi',
    badanSelesai.indexOf('res.json(') < badanSelesai.indexOf('bot.sendMessage(chatTujuan'),
    'menahan balasan agen demi Telegram memperlambat seluruh antrean');
  cek('D: notifikasi tidak ditunggu (void) + punya catch',
    /void bot\.sendMessage\(chatTujuan[\s\S]*?\.catch\(/.test(badanSelesai),
    'tanpa catch, kegagalan Telegram jadi unhandled rejection');
  cek('D: chatId tidak sah tidak dikirimi pesan', /if \(chatTujuan\)/.test(badanSelesai));

  // D-terakhir. Pesan Telegram harus memakai baris baru ASLI, bukan `\n`
  // mentah. Saat blok ini pertama ditulis, escape-nya terlapis dua kali
  // sehingga yang terkirim adalah teks "\n" — pesannya jadi satu baris
  // panjang. Kesalahan seperti ini tidak terlihat di `node --check`.
  const GANDA_N = String.fromCharCode(92, 92, 110);
  cek('D: pesan memakai baris baru asli (bukan escape ganda)',
    !badanSelesai.includes(GANDA_N),
    'ada ' + badanSelesai.split(GANDA_N).length - 1 + ' escape ganda: Telegram akan menampilkan "\\n" mentah');
  cek('D: pesan berisi baris baru yang sah',
    badanSelesai.includes(String.fromCharCode(92, 110)));

  // ══ E. Jeda penjemput ════════════════════════════════════════════════
  cek('E: PUSH_JEDA_NOTA_MS default 2000', /PUSH_JEDA_NOTA_MS \|\| 2000/.test(srcAgen),
    'jeda 5 detik membuat nota terasa tidak masuk-masuk');

  if (gagal) { console.error('\n' + gagal + ' GAGAL'); process.exit(1); }
  console.log('\nOK nota-masuk-folder: A + B + C + D + E');
})().catch((e) => { console.error('FATAL: ' + e.message); process.exit(1); });

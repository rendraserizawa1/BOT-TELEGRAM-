'use strict';
/**
 * TES: PERINGATAN TOKO OFFLINE
 *
 * Latar — insiden 20/11/2026
 * -------------------------
 * Ketiga toko gelap 79 menit. Bot SUDAH mengirim peringatan OFFLINE, tetapi
 * tidak ada satu baris log pun yang mencatat apakah pengiriman itu berhasil.
 * Akibatnya mustahil menjawab pertanyaan paling penting saat investigasi:
 * "apakah admin pernah diberi tahu?".
 *
 * Dua hal yang dikunci tes ini:
 *
 *   1. `__kirimAman` WAJIB mencatat hasil pengiriman (berhasil / gagal /
 *      jatuh ke teks polos). Tanpa jejak ini, kegagalan senyap bisa terjadi
 *      lagi tanpa ketahuan.
 *
 *   2. Ada peringatan GABUNGAN saat KETIGA toko mati bersamaan, dan
 *      peringatan itu hanya dikirim SEKALI per insiden. Tiga peringatan
 *      terpisah menyembunyikan fakta bahwa penyebabnya satu: PC pengirim
 *      mati / tidak ada yang login.
 *
 * Tes ini TIDAK menjalankan index.js (menjalankannya = bot kedua -> Telegram
 * 409). Yang diuji adalah sumbernya, seperti test-nota-masuk-folder.js.
 *
 * Jalankan: node boot/test-notif-offline.js
 */
const fs = require('fs');
const path = require('path');

const AKAR = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(AKAR, 'index.js'), 'utf8');

let lulus = 0;
let gagal = 0;
function cek(nama, syarat, ket) {
  if (syarat) { lulus++; console.log('  OK   ' + nama); }
  else { gagal++; console.log('  GAGAL ' + nama + (ket ? '  -> ' + ket : '')); }
}

// ── 1. Jejak pengiriman peringatan ────────────────────────────────
console.log('\n[1] __kirimAman mencatat hasil pengiriman');
const awalKirim = src.indexOf('const __kirimAman = async (chatId, teksMarkdown, teksPolos) => {');
cek('__kirimAman ditemukan', awalKirim >= 0);
const badanKirim = awalKirim >= 0 ? src.slice(awalKirim, awalKirim + 1400) : '';

cek('mencatat keberhasilan Markdown', /log\.info\('NOTIF'/.test(badanKirim));
cek('mencatat jatuh ke teks polos', /teks polos/.test(badanKirim));
cek('mencatat kegagalan', /log\.error\('NOTIF'/.test(badanKirim));
cek('kegagalan mengembalikan null', /return null;/.test(badanKirim));
cek('TIDAK menelan galat tanpa jejak',
  /catch \(e\) \{\s*log\.error\('NOTIF'/.test(badanKirim),
  'catch terakhir harus mencatat, bukan diam');

// ── 2. Peringatan gabungan tiga toko ──────────────────────────────
console.log('\n[2] Peringatan gabungan saat KETIGA toko mati');
cek('ada penanda __semuaMatiDilaporkan', /let __semuaMatiDilaporkan = false;/.test(src));
cek('menghitung toko yang mati', /jumlahMati\.length === 3/.test(src));
cek('menyebut ketiga toko dalam pesan', /CP, NK, dan KEFA/.test(src));
cek('menyebut PC pengirim sebagai penyebab', /komputer pengirim data \(BCODE-KEFA\) mati/.test(src));
cek('menyebut agen butuh login', /agen hanya hidup kalau ada yang login/.test(src));
cek('meminta periksa PC, bukan toko', /Periksa PC pengirim, bukan ketiga toko/.test(src));
cek('ada versi Markdown DAN teks polos',
  /\*KETIGA TOKO OFFLINE BERSAMAAN\*/.test(src) && /`KETIGA TOKO OFFLINE BERSAMAAN\\n`/.test(src));

// ── 3. Penahan agar tidak spam ────────────────────────────────────
console.log('\n[3] Peringatan gabungan hanya sekali per insiden');
cek('dikirim hanya bila belum dilaporkan', /if \(!__semuaMatiDilaporkan\) \{/.test(src));
cek('penanda di-set sebelum kirim', /__semuaMatiDilaporkan = true;/.test(src));
cek('penanda di-reset saat ada toko pulih',
  /__semuaMatiDilaporkan = false;\s*\/\/|else \{[\s\S]{0,400}__semuaMatiDilaporkan = false;/.test(src),
  'harus bisa terkirim lagi pada insiden berikutnya');

// ── 4. Tidak ada escape ganda (bug nyata yang pernah terjadi) ─────
console.log('\n[4] Tidak ada \\n ter-escape ganda');
const escapeGanda = (src.match(/\\\\n/g) || []).length;
cek('tidak ada literal backslash-backslash-n', escapeGanda === 0, 'ditemukan ' + escapeGanda);
cek('tidak ada karakter pengganti U+FFFD', !src.includes('\uFFFD'));

// ── 5. Peringatan per toko yang lama tetap utuh ───────────────────
console.log('\n[5] Perilaku lama tidak rusak');
cek('peringatan OFFLINE per toko masih ada', /iPos \$\{nama\} OFFLINE \$\{menit\} menit/.test(src));
cek('pemberitahuan pulih masih ada', /ONLINE lagi\* setelah \$\{menit\} menit/.test(src));
cek('jeda minimum 5 menit dipertahankan', /NOTIF_MULAI_MS = 5 \* 60 \* 1000/.test(src));
cek('jeda ulang 30 menit dipertahankan', /NOTIF_JEDA_MS = 30 \* 60 \* 1000/.test(src));
cek('loop tetap 60 detik', /}, 60 \* 1000\);/.test(src));

// ── 6. Simulasi logika penahan ────────────────────────────────────
console.log('\n[6] Simulasi: peringatan gabungan tidak berulang');
{
  let ditahan = false;
  let terkirim = 0;
  const siklus = (mati) => {
    if (mati === 3) {
      if (!ditahan) { ditahan = true; terkirim++; }
    } else { ditahan = false; }
  };
  for (let i = 0; i < 10; i++) siklus(3);      // 10 siklus ketiga mati
  cek('10 siklus ketiga mati -> 1 peringatan', terkirim === 1, 'dapat ' + terkirim);
  siklus(1); siklus(3);                         // pulih lalu mati lagi
  cek('insiden kedua -> peringatan baru', terkirim === 2, 'dapat ' + terkirim);
  siklus(2); siklus(2);
  cek('tidak ada peringatan saat hanya 2 mati', terkirim === 2, 'dapat ' + terkirim);
}

// ── Ringkasan ─────────────────────────────────────────────────────
console.log('\n' + '='.repeat(56));
console.log('  LULUS: ' + lulus + '   GAGAL: ' + gagal);
console.log('='.repeat(56));
if (gagal > 0) { console.log('\nADA YANG GAGAL.'); process.exit(1); }
console.log('\nSEMUA LULUS.');

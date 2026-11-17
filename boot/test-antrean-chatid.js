'use strict';
/**
 * Tes FUNGSIONAL antrean nota: chatId benar-benar mengalir?
 *
 * Tes statis (regex atas kode) hanya membuktikan tulisannya ada. Tes ini
 * menjalankan modul sungguhan dengan folder sementara dan membuktikan
 * perilakunya:
 *
 *   1. simpanKeAntrean() menulis nota + catatan samping berisi chatId
 *   2. daftarAntrean() tidak membocorkan berkas .json sebagai nota
 *   3. hapusDariAntrean() mengembalikan chatId & tujuan yang SAMA
 *   4. chatId besar (di atas Number.MAX_SAFE_INTEGER) tidak berubah angkanya
 *   5. nama tidak sah tetap ditolak (batas keamanan tidak longgar)
 *
 * Jalankan: node boot/test-antrean-chatid.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const notaMod = require('./nota-simpan');

let gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) console.log('  PASS  ' + nama);
  else { console.error('  GAGAL ' + nama + (detail !== undefined ? ' -> ' + detail : '')); gagal++; }
}

const folder = path.join(os.tmpdir(), 'uji-antrean-chatid-' + process.pid + '-' + Date.now());
const NAMA = 'ELT 000123-021126.jpg';
const BUFFER = Buffer.from('isi-nota-palsu-untuk-uji', 'utf8');
// ChatId di atas Number.MAX_SAFE_INTEGER (9007199254740991): sebagai Number
// nilainya akan dibulatkan, dan notifikasi bisa terkirim ke orang lain.
const CHAT_BESAR = '7412345678901234567';
const TUJUAN = '\\\\server\\share\\Nota bulan november 2026';

try {
  fs.mkdirSync(folder, { recursive: true });

  // ── 1. Simpan dengan chatId ───────────────────────────────────────────
  const simpan = notaMod.simpanKeAntrean(folder, NAMA, BUFFER, 'share tidak terjangkau', TUJUAN, CHAT_BESAR);
  cek('1: nota masuk antrean', simpan.ok === true, simpan.error);

  const metaPath = path.join(folder, NAMA + '.json');
  cek('1: catatan samping dibuat', fs.existsSync(metaPath));

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  cek('1: chatId tersimpan PERSIS (tidak dibulatkan)', meta.chatId === CHAT_BESAR,
    'dapat: ' + meta.chatId);
  cek('1: chatId disimpan sebagai string', typeof meta.chatId === 'string', typeof meta.chatId);
  cek('1: tujuan tersimpan', meta.tujuan === TUJUAN, meta.tujuan);

  // ── 2. daftarAntrean tidak membocorkan .json ──────────────────────────
  const daftar = notaMod.daftarAntrean(folder);
  cek('2: antrean berisi tepat 1 nota', daftar.length === 1, daftar.length);
  cek('2: berkas .json tidak dihitung sebagai nota',
    daftar.every((x) => !x.nama.endsWith('.json')), JSON.stringify(daftar.map((x) => x.nama)));
  cek('2: nama nota benar', daftar[0] && daftar[0].nama === NAMA, daftar[0] && daftar[0].nama);

  // ── 3. hapusDariAntrean mengembalikan meta ────────────────────────────
  const hapus = notaMod.hapusDariAntrean(folder, NAMA);
  cek('3: hapus berhasil', hapus.ok === true, hapus.error);
  cek('3: meta dikembalikan', !!hapus.meta, 'null = notifikasi tidak bisa dikirim');
  cek('3: chatId ikut dikembalikan', hapus.meta && hapus.meta.chatId === CHAT_BESAR,
    hapus.meta && hapus.meta.chatId);
  cek('3: tujuan ikut dikembalikan', hapus.meta && hapus.meta.tujuan === TUJUAN);
  cek('3: nota benar-benar terhapus', !fs.existsSync(path.join(folder, NAMA)));
  cek('3: catatan samping ikut terhapus', !fs.existsSync(metaPath));
  cek('3: antrean jadi kosong', notaMod.daftarAntrean(folder).length === 0);

  // ── 4. Antrean tanpa chatId (perilaku lama) tetap jalan ───────────────
  const tanpaChat = notaMod.simpanKeAntrean(folder, 'KEF 000001-021126.jpg', BUFFER, 'uji', TUJUAN);
  cek('4: nota tanpa chatId tetap bisa disimpan', tanpaChat.ok === true, tanpaChat.error);
  const metaKosong = JSON.parse(fs.readFileSync(path.join(folder, 'KEF 000001-021126.jpg.json'), 'utf8'));
  cek('4: chatId null bila tidak diberikan', metaKosong.chatId === null, metaKosong.chatId);
  const hapusKosong = notaMod.hapusDariAntrean(folder, 'KEF 000001-021126.jpg');
  cek('4: hapus tetap berhasil', hapusKosong.ok === true);
  cek('4: meta null/chatId null tidak membuat crash',
    !hapusKosong.meta || hapusKosong.meta.chatId === null);

  // ── 5. Batas keamanan tidak longgar ───────────────────────────────────
  for (const jahat of ['../../index.js', '..\\..\\index.js', '', 'a/b.jpg', '..']) {
    const r = notaMod.hapusDariAntrean(folder, jahat);
    cek('5: nama tidak sah ditolak: ' + JSON.stringify(jahat), r.ok === false);
  }
} finally {
  try { fs.rmSync(folder, { recursive: true, force: true }); } catch (_) {}
}

if (gagal) { console.error('\n' + gagal + ' GAGAL'); process.exit(1); }
console.log('\nOK antrean-chatid: 1 + 2 + 3 + 4 + 5');

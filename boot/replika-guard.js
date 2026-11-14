'use strict';
/**
 * Penjaga jumlah replika.
 *
 * Kunci single-instance lama (bot-instance-lock.js) memakai `wmic` dan
 * `netstat -ano -p TCP` — keduanya khusus Windows. Di Linux kedua alat itu
 * gagal, sehingga pemilikLockSah() mengembalikan null ("tidak bisa
 * dipastikan") dan lock SELALU boleh diambil. Aturan itu benar untuk PC
 * (jangan pernah memblokir diri sendiri), tetapi berbahaya di container:
 * dua replika = dua poller getUpdates dengan token sama = Telegram
 * 409 Conflict = pesan dan tombol pengguna hilang.
 *
 * ── Kenapa BUKAN RAILWAY_REPLICA_COUNT ───────────────────────────────────
 * Versi pertama modul ini hanya membaca `RAILWAY_REPLICA_COUNT`. Variabel
 * itu TIDAK ADA di daftar variabel sistem Railway (yang disediakan hanya
 * RAILWAY_REPLICA_ID dan RAILWAY_REPLICA_REGION). Akibatnya penjaga ini
 * INERT: `process.exit(3)` tidak pernah tercapai, dan satu-satunya yang
 * mencegah replika ganda hanyalah setelan `numReplicas: 1`.
 *
 * Perbaikan: kunci file EKSKLUSIF di dalam volume. Di POSIX,
 * `fs.openSync(f, 'wx')` benar-benar atomik (O_CREAT|O_EXCL), jadi dua
 * proses yang start bersamaan tidak bisa dua-duanya menang. Ini penjagaan
 * nyata, bukan sekadar konfigurasi.
 *
 * Windows: tidak berubah sama sekali. Kunci Windows yang lama tetap dipakai,
 * jadi perilaku bot di PC ini identik.
 */

const fs = require('fs');
const path = require('path');

const NAMA_KUNCI = '.bot-single-instance';

/** Apakah PID hidup? `process.kill(pid, 0)` hanya menguji keberadaan. */
function pidHidup(pid) {
  const n = parseInt(pid, 10);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    // EPERM = proses ada tetapi milik user lain.
    return err && err.code === 'EPERM';
  }
}

function bacaPid(fileKunci) {
  try {
    const teks = fs.readFileSync(fileKunci, 'utf8').trim();
    const n = parseInt(teks, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch (_) {
    return null;
  }
}

function bawaanFileKunci() {
  // Simpan di volume (DATA_DIR) supaya terlihat oleh semua replika.
  const dasar = process.env.DATA_DIR || process.env.STORAGE_DIR || path.join(__dirname, '..', 'storage');
  return path.join(dasar, NAMA_KUNCI);
}

/**
 * Pastikan hanya satu replika yang jalan.
 * Mengembalikan { ok, alasan, fileKunci }.
 */
function pastikanSatuReplika(opts) {
  const o = opts || {};
  const platform = o.platform || process.platform;

  // Sabuk ganda: kalau operator SENG AJA menyetel variabel ini, hormati.
  // (Railway tidak menyediakannya sendiri, jadi ini opsional.)
  const mentah = process.env.RAILWAY_REPLICA_COUNT;
  if (mentah !== undefined && mentah !== null && String(mentah).trim() !== '') {
    const n = parseInt(String(mentah).trim(), 10);
    if (Number.isFinite(n) && n > 1) {
      return {
        ok: false,
        fileKunci: null,
        alasan: 'RAILWAY_REPLICA_COUNT=' + n + '. Lebih dari 1 replika memicu poller ganda '
          + 'dan Telegram 409 Conflict (pesan & tombol pengguna hilang). Set jumlah replika = 1.',
      };
    }
  }

  // Windows: kunci lama (wmic/netstat) yang menangani. Jangan ubah perilaku PC.
  if (platform === 'win32') {
    return { ok: true, fileKunci: null, alasan: 'win32: kunci single-instance lama tetap dipakai' };
  }

  const fileKunci = o.fileKunci || bawaanFileKunci();
  try {
    fs.mkdirSync(path.dirname(fileKunci), { recursive: true });
  } catch (_) { /* biarkan open di bawah yang melaporkan */ }

  // Coba ambil kunci secara atomik.
  try {
    const fd = fs.openSync(fileKunci, 'wx');
    try { fs.writeSync(fd, String(process.pid)); } finally { fs.closeSync(fd); }
    return { ok: true, fileKunci, alasan: 'kunci diperoleh (pid ' + process.pid + ')' };
  } catch (err) {
    if (!err || err.code !== 'EEXIST') {
      // Tidak bisa menulis (mis. volume read-only). Jangan blokir bot karena
      // hal yang tidak bisa dipastikan; laporkan supaya terlihat di log.
      return { ok: true, fileKunci, alasan: 'kunci tidak bisa dibuat (' + (err && err.code) + ') - dilewati' };
    }
  }

  // Kunci sudah ada: milik siapa?
  const pemilik = bacaPid(fileKunci);
  if (pemilik === process.pid) {
    return { ok: true, fileKunci, alasan: 'kunci sudah dipegang proses ini' };
  }
  if (pemilik && pidHidup(pemilik)) {
    return {
      ok: false,
      fileKunci,
      alasan: 'Sudah ada instance bot lain yang hidup (pid ' + pemilik + ') memegang ' + fileKunci
        + '. Replika ganda akan memicu poller getUpdates ganda dan Telegram 409 Conflict '
        + '(pesan & tombol pengguna hilang). Set jumlah replika = 1.',
    };
  }

  // Stale (pemilik sudah mati / file rusak): ambil alih.
  try {
    fs.writeFileSync(fileKunci, String(process.pid));
    return { ok: true, fileKunci, alasan: 'kunci stale diambil alih (pid lama ' + (pemilik || 'tidak dikenal') + ')' };
  } catch (err) {
    return { ok: true, fileKunci, alasan: 'kunci stale tidak bisa ditulis (' + (err && err.code) + ') - dilewati' };
  }
}

/** Hapus kunci HANYA bila memang milik proses ini. */
function lepasKunciReplika(opts) {
  const o = opts || {};
  const fileKunci = o.fileKunci || bawaanFileKunci();
  try {
    const pemilik = bacaPid(fileKunci);
    if (pemilik === process.pid) fs.unlinkSync(fileKunci);
  } catch (_) { /* sudah hilang: tidak masalah */ }
}

module.exports = { pastikanSatuReplika, lepasKunciReplika, NAMA_KUNCI };

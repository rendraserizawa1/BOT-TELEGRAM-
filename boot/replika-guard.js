'use strict';
/**
 * Penjaga jumlah replika.
 *
 * Kunci single-instance (bot-instance-lock.js) memakai `wmic` dan
 * `netstat -ano -p TCP` — keduanya khusus Windows. Di Linux kedua alat itu
 * gagal, sehingga pemilikLockSah() mengembalikan null ("tidak bisa
 * dipastikan") dan lock SELALU boleh diambil. Aturan itu benar untuk PC
 * (jangan pernah memblokir diri sendiri), tetapi berbahaya di container:
 * dua replika = dua poller getUpdates dengan token sama = Telegram
 * 409 Conflict = pesan dan tombol pengguna hilang.
 *
 * Karena lock tidak bisa diandalkan di Linux, jumlah replika harus dijaga
 * di level platform. Modul ini menolak start bila Railway melaporkan > 1.
 */

function pastikanSatuReplika() {
  const mentah = process.env.RAILWAY_REPLICA_COUNT;
  if (mentah === undefined || mentah === null || String(mentah).trim() === '') {
    return { ok: true, alasan: 'satu replika (env tidak diset)' };
  }
  const n = parseInt(String(mentah).trim(), 10);
  if (!Number.isFinite(n)) {
    // Nilai tidak masuk akal: jangan matikan bot karena salah tulis env.
    return { ok: true, alasan: 'RAILWAY_REPLICA_COUNT tidak valid ("' + mentah + '") - dianggap 1' };
  }
  if (n > 1) {
    return {
      ok: false,
      alasan: 'RAILWAY_REPLICA_COUNT=' + n + '. Kunci single-instance tidak berfungsi di Linux, '
        + 'sehingga lebih dari 1 replika memicu poller ganda dan Telegram 409 Conflict '
        + '(pesan & tombol pengguna hilang). Set jumlah replika = 1.',
    };
  }
  return { ok: true, alasan: 'satu replika' };
}

module.exports = { pastikanSatuReplika };

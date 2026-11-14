'use strict';
/**
 * Alasan eksplisit saat data iPos tidak segar.
 *
 * `itemSegar` hanya boolean. Tanpa sebab, pengguna (dan kita sendiri) tidak
 * bisa membedakan:
 *   - toko memang tutup / tidak terjangkau (Tailscale putus, host mati), atau
 *   - koneksi hidup tetapi frame `items` berhenti mengalir (data basi).
 * Keduanya berarti angka yang tampil mungkin bukan harga hari ini, jadi
 * kalimatnya harus jujur dan menyebut sebabnya.
 *
 * ── Jebakan yang sudah diperbaiki ────────────────────────────────────────
 * `Number(null) === 0`, `Number('') === 0`, `Number(false) === 0`. Hanya
 * `undefined` yang menjadi NaN. ipos-bridge.js mengisi umurItemDetik = null
 * bila toko BELUM PERNAH sinkron, sehingga pemeriksaan `Number.isFinite`
 * lolos dan fungsi ini dulu memberi tahu pengguna:
 *
 *   "Data item terakhir 0 detik lalu — sedang disegarkan dari iPos."
 *
 * Itu menipu: belum ada data sama sekali. Karena itu nilai kosong dinormalkan
 * lebih dulu, dan "belum ada data" selalu menang atas cabang lain.
 *
 * Mengembalikan null bila data segar.
 */

/** Ubah umur mentah menjadi angka, atau NaN bila memang tidak ada nilainya. */
function umurSah(mentah) {
  if (mentah === null || mentah === undefined || mentah === '') return NaN;
  if (typeof mentah === 'boolean') return NaN;
  const n = Number(mentah);
  return Number.isFinite(n) ? n : NaN;
}

function alasanTidakSegar(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.itemSegar === true) return null;

  const umur = umurSah(s.umurItemDetik);
  const belumAdaData = !Number.isFinite(umur);

  if (belumAdaData) {
    // Harus menang atas cabang offline: menyebut "0 detik lalu" saat tidak
    // ada data adalah kebohongan yang paling berbahaya.
    return 'Belum ada data item dari iPos sejak bot hidup — angka di atas mungkin belum terbaru.';
  }

  if (s.online === false) {
    return 'iPos tidak terjangkau — angka di atas adalah data terakhir ('
      + Math.round(umur) + ' detik lalu).';
  }

  return 'Data item terakhir ' + Math.round(umur) + ' detik lalu — sedang disegarkan dari iPos.';
}

module.exports = { alasanTidakSegar, umurSah };

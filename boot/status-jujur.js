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
 * Mengembalikan null bila data segar.
 */

function alasanTidakSegar(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.itemSegar === true) return null;

  const umur = Number(s.umurItemDetik);

  if (s.online === false) {
    return 'iPos tidak terjangkau — angka di atas adalah data terakhir'
      + (Number.isFinite(umur) ? ' (' + Math.round(umur) + ' detik lalu)' : '')
      + '.';
  }

  if (!Number.isFinite(umur)) {
    return 'Belum ada data item dari iPos sejak bot hidup — angka di atas mungkin belum terbaru.';
  }

  return 'Data item terakhir ' + Math.round(umur) + ' detik lalu — sedang disegarkan dari iPos.';
}

module.exports = { alasanTidakSegar };

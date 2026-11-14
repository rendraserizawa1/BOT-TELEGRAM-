'use strict';
/**
 * Kalimat jujur tentang umur data laporan.
 *
 * MASALAH YANG DIPERBAIKI:
 *   Sebelumnya, bila `update` lebih tua dari 5 menit, bot menulis
 *   "kasir baru saja jual, tunggu ±1 mnt lalu ketik ulang".
 *   Kalimat itu HANYA benar bila penyebabnya transaksi yang baru masuk.
 *   Saat DB sumber MATI (kasus CP 2026-11-14: beku 146 menit), kalimat itu
 *   menyesatkan — pengguna menunggu 1 menit berkali-kali padahal data tidak
 *   akan pernah datang sampai sumbernya hidup.
 *
 * ATURAN:
 *   - < 5 mnt           -> "Update data: baru saja / N mnt lalu"
 *   - 5..29 mnt         -> "kasir baru saja jual" (wajar, transaksi baru masuk)
 *   - >= 30 mnt         -> peringatan SUMBER TIDAK MEMPERBARUI + periksa server
 *
 * Ambang 30 menit dipilih agar toko yang sedang sepi (tidak ada nota baru
 * memang tidak memperbarui `update`) tidak memicu alarm palsu.
 */

const AMBANG_BASI_MNT = 30;

/**
 * @param {number|null|undefined} updateMs  epoch ms dari field `update`
 * @param {number} [sekarangMs]  untuk pengujian
 * @returns {string} satu baris Markdown, atau '' bila tidak ada data
 */
function kalimatUmurLaporan(updateMs, sekarangMs) {
  const upd = Number(updateMs);
  if (!Number.isFinite(upd) || upd <= 0) return '';
  const kini = Number.isFinite(Number(sekarangMs)) ? Number(sekarangMs) : Date.now();
  const umurMnt = Math.round((kini - upd) / 60000);

  if (umurMnt > AMBANG_BASI_MNT) {
    const jam = Math.floor(umurMnt / 60);
    const sisa = umurMnt % 60;
    const lama = jam >= 1 ? `${jam} jam ${sisa} mnt` : `${umurMnt} mnt`;
    return `\n⚠️ Data penjualan TIDAK diperbarui sejak ${lama} lalu. ` +
      `Ini bukan transaksi baru yang tertunda — server sumber iPos kemungkinan ` +
      `sedang tidak terjangkau. Hubungi admin bila berlanjut.`;
  }
  if (umurMnt > 5) {
    return `\n⏳ Data ${umurMnt} mnt lalu — kasir baru saja jual, tunggu ±1 mnt lalu ketik ulang.`;
  }
  return `\n🕐 Update data: ${umurMnt <= 0 ? 'baru saja' : umurMnt + ' mnt lalu'}`;
}

module.exports = { kalimatUmurLaporan, AMBANG_BASI_MNT };

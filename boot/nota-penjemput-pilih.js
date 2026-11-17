'use strict';
/**
 * SIAPA YANG MENJEMPUT ANTREAN NOTA — satu aturan, satu tempat.
 *
 * KENAPA DIPISAH JADI MODUL
 * -------------------------
 * Bug nyata 17/11/2026: penjemput nota dipasang di KETIGA agen (cp, nk, kefa)
 * sekaligus. Antrean nota itu global, bukan per-toko, jadi ketiganya mengambil
 * nota yang sama, menulis berkas yang sama, dan menghapusnya bertiga. /health
 * membuktikannya: satu nota -> { daftar:35, isi:3, selesai:1 }.
 *
 * Aturan penunjukan ini harus bisa DIUJI tanpa menjalankan agen sungguhan,
 * karena bug-nya justru muncul dari interaksi antar-agen. Karena itu ia
 * dipisahkan ke sini.
 */

/**
 * @param {{akar:string, toko:string, tokoDitunjuk?:string}} opsi
 * @returns {{aktif:boolean, alasan:string|null}}
 */
function pilihPenjemputNota({ akar, toko, tokoDitunjuk } = {}) {
  const a = String(akar == null ? '' : akar).trim();
  const t = String(toko == null ? '' : toko).toLowerCase();
  const ditunjuk = String(tokoDitunjuk == null || tokoDitunjuk === ''
    ? 'cp'
    : tokoDitunjuk).toLowerCase();

  // Akar kosong = fitur mati. Perilaku PC yang belum mengisinya tidak berubah.
  if (!a) {
    return {
      aktif: false,
      alasan: 'PUSH_NOTA_AKAR kosong - penjemput nota mati, antrean tidak akan tersapu',
    };
  }

  if (!t) {
    return { aktif: false, alasan: 'nama toko kosong - tidak bisa menentukan penjemput nota' };
  }

  if (t !== ditunjuk) {
    return {
      aktif: false,
      alasan: 'toko ' + t + ' bukan penjemput nota yang ditunjuk (PUSH_NOTA_TOKO=' + ditunjuk + ')',
    };
  }

  return { aktif: true, alasan: null };
}

module.exports = { pilihPenjemputNota };

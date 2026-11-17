'use strict';
/**
 * GUDANG DORONGAN iPos — satu tempat penyimpanan bersama.
 *
 * KENAPA MODUL TERPISAH
 * ---------------------
 * `push-penerima.js` hanya berisi logika murni (bisa diuji tanpa server).
 * Modul ini adalah INSTANS TUNGGAL-nya, dipakai oleh DUA pihak:
 *   - index.js      : menulis data yang masuk lewat HTTP
 *   - ipos-bridge.js: membaca data itu sebagai pengganti fetch ke iPos
 *
 * Kalau masing-masing membuat instans sendiri, penerima akan menulis ke
 * gudang yang berbeda dari yang dibaca bridge — data masuk tetapi bot tetap
 * melihat kosong, dan penyebabnya tidak terlihat sama sekali. Karena itu
 * `require` di-cache Node (satu modul = satu instans) dan itulah yang dipakai.
 *
 * PERILAKU LOKAL TIDAK BERUBAH
 * ----------------------------
 * Bila `PUSH_TOKEN` kosong, `aktif()` selalu false sehingga bridge tetap
 * menarik dari iPos seperti sebelumnya. Tidak ada satu pun jalur baru yang
 * aktif tanpa sengaja.
 *
 * TANGGAL LAMPAU
 * --------------
 * Jalur dorongan hanya membawa laporan HARI INI. Laporan tanggal lampau
 * (mis. marketplace 14/11) disimpan per rentang, dan bila belum ada, bot
 * mencatat PESANAN yang dijemput PC lalu dikirim balik. Tidak ada koneksi
 * masuk ke PC, jadi arah data tetap PC -> Railway.
 */
const { buatPenerima } = require('./push-penerima');

const TOKEN = String(process.env.PUSH_TOKEN || '');

const penerima = buatPenerima({
  token: TOKEN,
  batasSegarDetik: Number(process.env.PUSH_BATAS_SEGAR_DETIK || 180),
  // Katalog penuh dikirim tiap 15 menit dan delta hanya saat ada perubahan,
  // jadi batas katalog HARUS lebih longgar dari itu. Kalau disamakan dengan
  // batas laporan (180 dtk), toko sepi yang sehat akan selalu tampak "basi".
  batasSegarItemsDetik: Number(process.env.PUSH_BATAS_SEGAR_ITEMS_DETIK || 1200),
});

/** Apakah mode dorong menyala sama sekali (token diisi). */
function aktif() {
  return !!TOKEN;
}

/**
 * PENGHITUNG VERSI per toko.
 *
 * Kenapa perlu: katalog berisi ~4593 item. Kalau bot memproses ulang seluruh
 * katalog tiap 2 detik, CPU terbuang padahal datanya tidak berubah. Dengan
 * penghitung ini bot cukup membandingkan SATU ANGKA, dan baru memproses ketika
 * benar-benar ada kiriman baru. Murah dan tepat.
 */
const versi = new Map();

function versiSekarang(toko) {
  return versi.get(toko) || 0;
}

/** Terima satu kiriman. Lihat push-penerima.js untuk aturan validasinya. */
function terima(paket, tokenDikirim) {
  const hasil = penerima.terima(paket, tokenDikirim);
  if (hasil.status === 200) {
    const toko = String((paket && paket.toko) || '').toLowerCase();
    // Delta dan katalog penuh sama-sama mengubah isi -> versi naik.
    versi.set(toko, (versi.get(toko) || 0) + 1);
  }
  return hasil;
}

/**
 * Data terakhir untuk toko+jenis, HANYA bila masih segar.
 * Mengembalikan null bila belum pernah ada atau sudah basi — supaya pemanggil
 * tidak diam-diam memakai data beku seolah-olah segar.
 *
 * SEMANTIK `batasDetik` (penting):
 *   undefined / null -> tanpa batas (dipakai untuk inspeksi manual)
 *   0                -> TIDAK ADA yang dianggap segar
 *   n > 0            -> segar bila umur <= n detik
 *
 * Dulu 0 diperlakukan sama dengan "tanpa batas". Akibatnya orang yang menyetel
 * batas 0 untuk MEMATIKAN data dorongan justru mendapat kebalikannya: data
 * beku diterima selamanya. Kesalahan yang berbahaya karena tampak benar.
 */
function ambilSegar(toko, jenis, batasDetik) {
  const data = penerima.ambil(toko, jenis);
  if (data == null) return null;
  const s = penerima.status(toko);
  const kunci = { items: 'items', jual: 'jual', 'jual-merek': 'jualMerek', 'jual-marketplace': 'jualMarketplace', kasir: 'kasir' }[jenis];
  const ringkas = kunci ? s[kunci] : null;
  if (!ringkas) return null;
  const batas = (batasDetik === undefined || batasDetik === null) ? Infinity : Number(batasDetik);
  if (Number.isFinite(batas) && Number(ringkas.umurDetik) > batas) return null;
  return data;
}

/** Umur data dalam detik, atau null bila belum pernah ada. */
function umurDetik(toko, jenis) {
  const s = penerima.status(toko);
  const kunci = { items: 'items', jual: 'jual', 'jual-merek': 'jualMerek', 'jual-marketplace': 'jualMarketplace', kasir: 'kasir' }[jenis];
  const ringkas = kunci ? s[kunci] : null;
  return ringkas ? ringkas.umurDetik : null;
}

function status(toko) {
  return penerima.status(toko);
}

/**
 * LAPORAN UNTUK RENTANG TANGGAL TERTENTU (mis. marketplace 14/11/2026).
 *
 * Jalur cepat di atas hanya menyimpan laporan HARI INI. Tanggal lampau disimpan
 * terpisah per rentang, karena laporan tanggal lampau tidak berubah lagi dan
 * boleh dipakai ulang tanpa meminta ke PC.
 */
function ambilRentang(toko, jenis, dari, sampai) {
  return penerima.ambilRentang(String(toko || '').toLowerCase(), jenis, dari, sampai);
}

/**
 * Catat kebutuhan akan satu rentang. PC akan menjemputnya dan mengirim hasilnya.
 * Aman dipanggil berulang: satu rentang hanya menjadi satu pesanan.
 */
function mintaRentang(toko, jenis, dari, sampai) {
  return penerima.mintaRentang(String(toko || '').toLowerCase(), jenis, dari, sampai);
}

/** Daftar pesanan yang menunggu dijemput PC (dipakai endpoint /api/ipos/perlu). */
function jemputPermintaan(toko) {
  return penerima.jemputPermintaan(String(toko || '').toLowerCase());
}

/** Buang pesanan setelah hasilnya diterima. */
function hapusPermintaan(toko, jenis, dari, sampai) {
  return penerima.hapusPermintaan(toko, jenis, dari, sampai);
}

/**
 * Laporan yang menempati SLOT UTAMA (jalur cepat) untuk satu jenis, tanpa
 * memandang kesegaran.
 *
 * Dipakai bridge untuk membedakan "ini laporan HARI INI" dari "ini laporan
 * tanggal lampau":
 *   - laporan HARI INI wajib segar, kalau tidak jangan disajikan;
 *   - laporan tanggal LAMPAU tidak berubah lagi, jadi boleh dipakai ulang.
 * Tanpa pembedaan ini, laporan beku bisa disajikan sebagai laporan hari ini.
 */
function laporanSlot(toko, jenis) {
  const d = penerima.ambil(String(toko || '').toLowerCase(), jenis);
  return d && typeof d === 'object' ? d : null;
}

/** HANYA untuk uji: mundurkan waktu terima agar kesegaran bisa diuji tanpa menunggu. */
function _mundurkanWaktu(toko, jenis, ms) {
  return penerima._mundurkanWaktu(toko, jenis, ms);
}

module.exports = {
  aktif, terima, ambilSegar, umurDetik, status, versiSekarang, _mundurkanWaktu,
  ambilRentang, mintaRentang, jemputPermintaan, hapusPermintaan, laporanSlot,
};

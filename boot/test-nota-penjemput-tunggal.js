'use strict';
/**
 * Tes: hanya SATU agen yang menjemput antrean nota.
 *
 * BUG YANG DIUJI (terjadi sungguhan di produksi 17/11/2026)
 * --------------------------------------------------------
 * Antrean nota itu GLOBAL, bukan per-toko. Saat penjemput dipasang di ketiga
 * agen (cp, nk, kefa) sekaligus, ketiganya mengambil nota yang SAMA, menulis
 * berkas yang sama ke share, lalu menghapusnya bertiga.
 *
 * Bukti dari /health produksi: satu nota menghasilkan
 *   notaJemput = { daftar:35, isi:3, selesai:1 }
 * dan push-status.json mencatat kiriman.nota = 3.
 *
 * Akibatnya: tiga kali transfer untuk satu nota, tiga kali tulis ke berkas
 * yang sama (berisiko .part bertabrakan), dan dua "selesai" yang gagal karena
 * berkasnya sudah dihapus agen lain.
 *
 * Perbaikan: satu agen ditunjuk lewat PUSH_NOTA_TOKO (bawaan 'cp').
 *
 * Tes ini menguji ATURAN PENUNJUKAN tanpa perlu menjalankan agen sungguhan:
 * fungsinya diekstrak ke modul supaya bisa diuji langsung.
 */

const { pilihPenjemputNota } = require('./nota-penjemput-pilih.js');

let gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) console.log('  PASS  ' + nama);
  else { console.error('  GAGAL ' + nama + (detail !== undefined ? ' -> ' + detail : '')); gagal++; }
}

// ══ A. Akar kosong -> penjemput mati (perilaku PC tidak berubah) ════════
cek('A: akar kosong -> tidak ada penjemput',
  pilihPenjemputNota({ akar: '', toko: 'cp' }).aktif === false);
cek('A: akar kosong -> alasan jelas',
  /PUSH_NOTA_AKAR/.test(pilihPenjemputNota({ akar: '', toko: 'cp' }).alasan || ''),
  pilihPenjemputNota({ akar: '', toko: 'cp' }).alasan);

// ══ B. Hanya toko yang ditunjuk yang aktif ══════════════════════════════
const akar = '\\\\100.125.99.99\\E\\TOKO NASIONAL KITCHEN';

const cp = pilihPenjemputNota({ akar, toko: 'cp', tokoDitunjuk: 'cp' });
const nk = pilihPenjemputNota({ akar, toko: 'nk', tokoDitunjuk: 'cp' });
const kefa = pilihPenjemputNota({ akar, toko: 'kefa', tokoDitunjuk: 'cp' });

cek('B: cp (ditunjuk) AKTIF', cp.aktif === true, JSON.stringify(cp));
cek('B: nk (tidak ditunjuk) MATI', nk.aktif === false, JSON.stringify(nk));
cek('B: kefa (tidak ditunjuk) MATI', kefa.aktif === false, JSON.stringify(kefa));

// Inilah inti bug: hanya SATU yang boleh aktif dari tiga agen.
const jumlahAktif = [cp, nk, kefa].filter((x) => x.aktif).length;
cek('B: tepat SATU agen aktif dari tiga', jumlahAktif === 1, jumlahAktif);

// ══ C. Bawaan adalah cp (tidak berubah bila env tidak diisi) ════════════
const bawaan = pilihPenjemputNota({ akar, toko: 'cp' });
cek('C: tanpa PUSH_NOTA_TOKO, cp tetap aktif', bawaan.aktif === true, JSON.stringify(bawaan));

// ══ D. Bisa dipindah ke toko lain lewat env ═════════════════════════════
const nkDitunjuk = pilihPenjemputNota({ akar, toko: 'nk', tokoDitunjuk: 'nk' });
cek('D: PUSH_NOTA_TOKO=nk -> nk aktif', nkDitunjuk.aktif === true);
cek('D: PUSH_NOTA_TOKO=nk -> cp mati',
  pilihPenjemputNota({ akar, toko: 'cp', tokoDitunjuk: 'nk' }).aktif === false);

// ══ E. Huruf besar/kecil tidak masalah ══════════════════════════════════
cek('E: PUSH_NOTA_TOKO=CP (huruf besar) tetap cocok',
  pilihPenjemputNota({ akar, toko: 'cp', tokoDitunjuk: 'CP' }).aktif === true);

// ══ F. Salah konfigurasi harus TERLIHAT, bukan diam ═════════════════════
const salah = pilihPenjemputNota({ akar, toko: 'cp', tokoDitunjuk: 'toko-yang-tidak-ada' });
cek('F: toko tidak dikenal -> mati', salah.aktif === false);
cek('F: toko tidak dikenal -> ada alasan peringatan',
  !!salah.alasan && /tidak|bukan|TIDAK/i.test(salah.alasan), salah.alasan);

if (gagal) { console.error('\n' + gagal + ' GAGAL'); process.exit(1); }
console.log('\nOK nota-penjemput-pilih: A + B + C + D + E + F');

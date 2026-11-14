'use strict';
/**
 * Tes: alasan eksplisit saat data iPos tidak segar.
 *
 * Kenapa: bila kunci Tailscale kedaluwarsa atau toko tidak terjangkau, bot
 * tetap hidup dan menyajikan angka TERAKHIR tanpa penjelasan. Pengguna
 * mengira itu harga hari ini. Harapan wajar: status menyebut SEBAB-nya.
 *
 * Kontrak: alasanTidakSegar(s) -> string|null
 */

const { alasanTidakSegar } = require('./status-jujur.js');

let gagal = 0;

// 1) Koneksi mati -> sebut "tidak terjangkau"
let a = alasanTidakSegar({ online: false, itemSegar: false, umurItemDetik: 9999 });
if (!a || !/tidak terjangkau/i.test(a)) { console.error('GAGAL 1: ' + a); gagal++; }

// 2) Online tapi data item tua -> sebut umurnya
let b = alasanTidakSegar({ online: true, itemSegar: false, umurItemDetik: 400 });
if (!b || !/400/.test(b)) { console.error('GAGAL 2: ' + b); gagal++; }

// 3) Segar -> null
let c = alasanTidakSegar({ online: true, itemSegar: true, umurItemDetik: 5 });
if (c !== null) { console.error('GAGAL 3: harus null, dapat ' + c); gagal++; }

// 4) Belum pernah ada data sama sekali -> jangan tampilkan "undefined"
let d = alasanTidakSegar({ online: true, itemSegar: false, umurItemDetik: null });
if (!d || /undefined|null|NaN/.test(d)) { console.error('GAGAL 4: ' + d); gagal++; }

// 5) Masukan kosong -> jangan crash
let e = alasanTidakSegar(null);
if (typeof e !== 'string' && e !== null) { console.error('GAGAL 5: ' + e); gagal++; }

if (gagal) process.exit(1);
console.log('OK status-jujur 5/5');

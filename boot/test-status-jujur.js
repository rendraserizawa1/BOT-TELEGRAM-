'use strict';
/**
 * Tes: alasanTidakSegar harus JUJUR dan tidak pernah menipu.
 *
 * TEMUAN REVIEW (Important I2): `Number(null) === 0`, `Number('') === 0`,
 * `Number(false) === 0`. Hanya `undefined` yang menjadi NaN. ipos-bridge.js
 * mengisi umurItemDetik = null bila toko BELUM PERNAH sinkron, sehingga
 * pemeriksaan `Number.isFinite(umur)` lolos dan fungsi jatuh ke kalimat
 * "Data item terakhir 0 detik lalu — sedang disegarkan dari iPos."
 *
 * Itu kebalikan dari tujuan modul ini: pengguna diberi tahu datanya BARU
 * padahal belum ada data sama sekali. Selain itu mengubah perilaku lokal,
 * karena stempelKesegaran() lama mengembalikan '' untuk kasus null.
 *
 * Kontrak:
 *   itemSegar === true          -> null (tidak ada peringatan)
 *   umur null/undefined/''/NaN  -> kalimat "belum ada data", TIDAK menyebut detik
 *   offline + umur sah          -> kalimat "tidak terjangkau (N detik lalu)"
 *   online + umur sah           -> kalimat "N detik lalu, sedang disegarkan"
 */

const { alasanTidakSegar } = require('./status-jujur.js');

let gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) console.log('  PASS  ' + nama);
  else { console.error('  GAGAL ' + nama + (detail !== undefined ? ' -> ' + detail : '')); gagal++; }
}

function tidakBohong(teks) {
  if (typeof teks !== 'string') return false;
  if (/undefined|null|NaN/.test(teks)) return false;
  if (/0 detik/.test(teks)) return false;
  return true;
}

// ── 1. Data segar -> tidak ada peringatan
cek('segar -> null', alasanTidakSegar({ itemSegar: true, umurItemDetik: 12, online: true }) === null);

// ── 2. KASUS INTI I2: belum pernah sinkron (umurItemDetik = null)
const a = alasanTidakSegar({ itemSegar: false, umurItemDetik: null, online: false });
cek('null + offline -> jujur, tanpa "0 detik"', tidakBohong(a), a);
cek('null + offline menyebut belum ada data', /belum ada data/i.test(a || ''), a);

const b = alasanTidakSegar({ itemSegar: false, umurItemDetik: null, online: true });
cek('null + online -> jujur, tanpa "0 detik"', tidakBohong(b), b);
cek('null + online menyebut belum ada data', /belum ada data/i.test(b || ''), b);

// ── 3. undefined / '' / NaN diperlakukan sama
for (const nilai of [undefined, '', NaN, false]) {
  const t = alasanTidakSegar({ itemSegar: false, umurItemDetik: nilai, online: true });
  cek('umur=' + String(nilai) + ' -> tidak menipu', tidakBohong(t) && /belum ada data/i.test(t || ''), t);
}

// ── 4. Offline dengan umur sah -> sebut angka
const c = alasanTidakSegar({ itemSegar: false, umurItemDetik: 90, online: false });
cek('offline + 90 dtk -> sebut 90', /90 detik lalu/.test(c || ''), c);
cek('offline + 90 dtk -> sebut tidak terjangkau', /tidak terjangkau/i.test(c || ''), c);

// ── 5. Online tapi basi -> sebut angka
const d = alasanTidakSegar({ itemSegar: false, umurItemDetik: 300, online: true });
cek('online + 300 dtk -> sebut 300', /300 detik lalu/.test(d || ''), d);

// ── 6. Masukan rusak tidak boleh melempar
for (const buruk of [null, undefined, 0, 'x', []]) {
  let lempar = false;
  try { alasanTidakSegar(buruk); } catch (_) { lempar = true; }
  cek('masukan ' + JSON.stringify(buruk) + ' tidak melempar', !lempar);
}

// ── 7. umur 0 yang SAH (baru saja) tetap boleh menyebut 0 detik
const e = alasanTidakSegar({ itemSegar: false, umurItemDetik: 0, online: true });
cek('umur 0 sah -> kalimat tetap masuk akal', typeof e === 'string' && !/undefined|null|NaN/.test(e), e);

if (gagal) { console.error('\n' + gagal + ' GAGAL'); process.exit(1); }
console.log('\nOK status-jujur: tidak pernah menipu saat data belum ada');

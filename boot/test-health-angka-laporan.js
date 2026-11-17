'use strict';
/**
 * UJI: /health HARUS MENAMPILKAN ANGKA LAPORAN, BUKAN null.
 *
 * BUG YANG DIUJI
 * --------------
 * push-penerima membaca `jual.data.nota` dan `jual.data.omzet`. Bentuk laporan
 * iPos menaruh angka itu di `total`, sehingga /health SELALU melaporkan
 * `nota: null, omzet: null` — tampak seperti laporan kosong padahal isinya ada.
 *
 * AKIBAT NYATA: saat menyelidiki kebekuan CP, /health menampilkan
 * `total=null nota=null omzet=null` sehingga tampak seolah laporan tidak
 * pernah masuk. Yang kosong adalah PEMBACAANNYA, bukan datanya. Diagnosis
 * jadi menyesatkan dan waktu habis untuk mengejar masalah yang tidak ada.
 *
 * YANG DIBUKTIKAN
 * ---------------
 *  1. Bentuk asli iPos (`total.nota` / `total.omzet`) -> /health menampilkan angkanya.
 *  2. Bentuk lama (`nota` / `omzet` di akar) tetap terbaca (build proxy lain).
 *  3. `updateSebab` ikut tampil supaya sebab kebekuan terlihat di /health.
 *  4. Laporan tanpa angka -> null, bukan crash dan bukan 0 palsu.
 */
const assert = require('assert');
// Token harus ada SEBELUM push-gudang di-require: modul itu membaca
// process.env.PUSH_TOKEN saat dimuat, jadi menetapkannya setelahnya percuma.
// Tanpa ini uji hanya lulus bila kebetulan dijalankan dengan PUSH_TOKEN di
// lingkungan — dan gagal misterius saat dijalankan bersama uji lain.
if (!process.env.PUSH_TOKEN) process.env.PUSH_TOKEN = 'token-uji-lokal';
const gudang = require('./push-gudang');

let lulus = 0, gagal = 0;
function uji(nama, fn) {
  try { fn(); lulus++; console.log('  OK   ' + nama); }
  catch (e) { gagal++; console.log('  GAGAL ' + nama + ' -> ' + e.message); }
}

const TOKEN = process.env.PUSH_TOKEN;
const TOKO = 'cp';

function dorong(data) {
  return gudang.terima({ toko: TOKO, jenis: 'jual', data }, TOKEN);
}

function ringkasJual() {
  const r = gudang.status(TOKO);
  return r && r.jual;
}

console.log('=== uji pembacaan angka laporan di /health ===');

uji('bentuk ASLI iPos (total.nota / total.omzet) -> angka tampil', () => {
  dorong({
    siap: true, dari: '2026-11-17', sampai: '2026-11-17',
    kasir: [{ user: 'ASTRID-WINDI', nota: 18 }],
    total: { nota: 18, item: 55, omzet: 24813000 },
    update: 1794877695841,
  });
  const j = ringkasJual();
  assert.ok(j, 'ringkasan jual harus ada');
  assert.strictEqual(j.nota, 18, 'nota harus 18, dapat: ' + j.nota);
  assert.strictEqual(j.omzet, 24813000, 'omzet harus 24813000, dapat: ' + j.omzet);
  assert.strictEqual(j.update, 1794877695841);
});

uji('bentuk LAMA (nota di akar) tetap terbaca', () => {
  dorong({
    siap: true, dari: '2026-11-17', sampai: '2026-11-17',
    nota: 7, omzet: 1000000, update: 1794877695999,
  });
  const j = ringkasJual();
  assert.strictEqual(j.nota, 7, 'bentuk lama harus tetap terbaca');
  assert.strictEqual(j.omzet, 1000000);
});

uji('updateSebab ikut tampil di /health', () => {
  dorong({
    siap: true, dari: '2026-11-17', sampai: '2026-11-17',
    total: { nota: 18, omzet: 24813000 },
    update: 1794877695841,
    updateSebab: 'connect ENETUNREACH 192.168.77.250:5444',
  });
  const j = ringkasJual();
  assert.strictEqual(j.updateSebab, 'connect ENETUNREACH 192.168.77.250:5444',
    'sebab kebekuan harus terlihat di /health');
});

uji('tanpa updateSebab -> null (bukan undefined yang hilang dari JSON)', () => {
  dorong({
    siap: true, dari: '2026-11-17', sampai: '2026-11-17',
    total: { nota: 18, omzet: 24813000 }, update: 1794877695841,
  });
  const j = ringkasJual();
  assert.strictEqual(j.updateSebab, null);
});

uji('laporan tanpa angka -> null, bukan 0 palsu dan bukan crash', () => {
  dorong({ siap: true, dari: '2026-11-17', sampai: '2026-11-17', update: 1794877695841 });
  const j = ringkasJual();
  assert.strictEqual(j.nota, null, 'tidak boleh mengarang 0');
  assert.strictEqual(j.omzet, null, 'tidak boleh mengarang 0');
});

uji('total.nota = 0 tetap 0 (bukan dianggap kosong)', () => {
  dorong({
    siap: true, dari: '2026-11-17', sampai: '2026-11-17',
    total: { nota: 0, omzet: 0 }, update: 1794877695841,
  });
  const j = ringkasJual();
  assert.strictEqual(j.nota, 0, 'nol penjualan adalah angka sah, jangan jadi null');
  assert.strictEqual(j.omzet, 0);
});

console.log('');
console.log('  lulus ' + lulus + '/' + (lulus + gagal));
if (gagal) { console.log('  ADA YANG GAGAL'); process.exit(1); }
console.log('  SEMUA LULUS');

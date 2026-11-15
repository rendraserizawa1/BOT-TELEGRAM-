'use strict';
/**
 * Uji DENYUT dan BATAS KESEGARAN TERPISAH.
 *
 * Kenapa ini diuji khusus: dua kegagalan di sini sama-sama "diam" — tidak ada
 * error, tidak ada log, hanya status yang salah:
 *
 * 1. Tanpa denyut, "toko sepi" dan "PC mati" tampak identik dari server.
 *    Alarm kesegaran lalu memerah setiap malam padahal semuanya sehat, dan
 *    orang berhenti mempercayai alarm — kegagalan yang lebih berbahaya
 *    daripada tidak punya alarm.
 *
 * 2. Kalau batas katalog disamakan dengan batas laporan (180 dtk), katalog
 *    yang benar-benar sehat akan dibuang tiap beberapa menit dan bot jatuh
 *    kembali ke data Excel — persis keluhan "data tidak update".
 */
const assert = require('assert');
const { buatPenerima } = require('./push-penerima');

let lulus = 0, gagal = 0;
const uji = (nama, fn) => {
  try { fn(); lulus++; console.log('  OK    ' + nama); }
  catch (e) { gagal++; console.log('  GAGAL ' + nama + ' -> ' + e.message); }
};

console.log('=== uji denyut & batas kesegaran ===');

uji('denyut diterima tanpa data', () => {
  const p = buatPenerima({ token: 't' });
  const r = p.terima({ toko: 'kefa', jenis: 'denyut' }, 't');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.denyut, true);
});

uji('denyut TIDAK menyentuh katalog', () => {
  const p = buatPenerima({ token: 't' });
  p.terima({ toko: 'kefa', jenis: 'items', data: [{ kode: 'A' }, { kode: 'B' }] }, 't');
  p._mundurkanWaktu('kefa', 'items', 600000); // katalog 10 menit
  const sebelum = p.ambil('kefa', 'items');
  p.terima({ toko: 'kefa', jenis: 'denyut' }, 't');
  const sesudah = p.ambil('kefa', 'items');
  assert.strictEqual(sesudah.length, sebelum.length, 'isi katalog tidak boleh berubah');
  // Umur katalog juga TIDAK boleh ikut menyegar — kalau ikut, kita kehilangan
  // kemampuan membedakan "isi baru" dari "PC masih hidup".
  assert.strictEqual(p.status('kefa').items.umurDetik >= 599, true,
    'umur katalog harus tetap tua, dapat ' + p.status('kefa').items.umurDetik);
});

uji('denyut melaporkan kesegaran sendiri', () => {
  const p = buatPenerima({ token: 't', batasSegarDetik: 180 });
  p.terima({ toko: 'kefa', jenis: 'denyut' }, 't');
  assert.strictEqual(p.status('kefa').denyut.segar, true);
  p._mundurkanWaktu('kefa', 'denyut', 200000);
  assert.strictEqual(p.status('kefa').denyut.segar, false);
});

uji('katalog tua tetap SEGAR menurut batas katalog (20 menit)', () => {
  const p = buatPenerima({ token: 't', batasSegarDetik: 180, batasSegarItemsDetik: 1200 });
  p.terima({ toko: 'kefa', jenis: 'items', data: [{ kode: 'A' }] }, 't');
  p._mundurkanWaktu('kefa', 'items', 600000); // 10 menit
  assert.strictEqual(p.status('kefa').items.segar, true,
    'katalog 10 menit harus tetap segar (toko sepi itu normal)');
});

uji('katalog lewat 20 menit baru dianggap basi', () => {
  const p = buatPenerima({ token: 't', batasSegarItemsDetik: 1200 });
  p.terima({ toko: 'kefa', jenis: 'items', data: [{ kode: 'A' }] }, 't');
  p._mundurkanWaktu('kefa', 'items', 1300000); // 21,7 menit
  assert.strictEqual(p.status('kefa').items.segar, false);
});

uji('laporan memakai batas pendek (180 dtk), bukan batas katalog', () => {
  const p = buatPenerima({ token: 't', batasSegarDetik: 180, batasSegarItemsDetik: 1200 });
  p.terima({ toko: 'kefa', jenis: 'jual', data: { total: 1 } }, 't');
  p._mundurkanWaktu('kefa', 'jual', 300000); // 5 menit
  assert.strictEqual(p.status('kefa').jual.segar, false,
    'laporan 5 menit harus BASI karena dikirim ulang tiap ~60 dtk');
});

uji('denyut berulang menaikkan jumlahPush', () => {
  const p = buatPenerima({ token: 't' });
  p.terima({ toko: 'kefa', jenis: 'denyut' }, 't');
  p.terima({ toko: 'kefa', jenis: 'denyut' }, 't');
  assert.strictEqual(p.status('kefa').denyut.jumlahPush, 2);
});

uji('denyut tanpa token tetap ditolak', () => {
  const p = buatPenerima({ token: 't' });
  const r = p.terima({ toko: 'kefa', jenis: 'denyut' }, 'salah');
  assert.strictEqual(r.status, 401);
});

uji('status menyertakan denyut null sebelum ada kiriman', () => {
  const p = buatPenerima({ token: 't' });
  assert.strictEqual(p.status('kefa').denyut, null);
});

uji('kunci status lengkap (tidak ada yang hilang)', () => {
  const p = buatPenerima({ token: 't' });
  const s = p.status('kefa');
  for (const k of ['items', 'jual', 'jualMerek', 'jualMarketplace', 'kasir', 'denyut']) {
    assert.ok(k in s, 'kunci ' + k + ' harus ada');
  }
});

console.log('\n  lulus ' + lulus + '/' + (lulus + gagal));
if (gagal) { console.log('  ADA YANG GAGAL'); process.exit(1); }
console.log('  SEMUA LULUS');

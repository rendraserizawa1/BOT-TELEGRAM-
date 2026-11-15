'use strict';
/**
 * Uji DELTA katalog (items-ubah).
 *
 * Kenapa ini perlu diuji terpisah: delta adalah satu-satunya jalur yang
 * MENGGABUNGKAN data, bukan menimpanya. Kalau penggabungan salah, toko bisa
 * tampak kehilangan ribuan barang — kegagalan yang jauh lebih berbahaya
 * daripada sekadar tidak update.
 */
const assert = require('assert');
const { buatPenerima } = require('./push-penerima');

let lulus = 0, gagal = 0;
const uji = (nama, fn) => {
  try { fn(); lulus++; console.log('  OK    ' + nama); }
  catch (e) { gagal++; console.log('  GAGAL ' + nama + ' -> ' + e.message); }
};

console.log('=== uji delta katalog ===');

uji('delta tanpa katalog penuh -> 409 (jangan buat katalog 3 item)', () => {
  const p = buatPenerima({ token: 't' });
  const r = p.terima({ toko: 'kefa', jenis: 'items-ubah', data: [{ kode: 'A' }] }, 't');
  assert.strictEqual(r.status, 409);
  assert.strictEqual(p.ambil('kefa', 'items'), null);
});

uji('delta menggabungkan, bukan menimpa', () => {
  const p = buatPenerima({ token: 't' });
  p.terima({ toko: 'kefa', jenis: 'items', data: [
    { kode: 'A', stok: 1 }, { kode: 'B', stok: 2 }, { kode: 'C', stok: 3 },
  ] }, 't');
  const r = p.terima({ toko: 'kefa', jenis: 'items-ubah', data: [{ kode: 'B', stok: 99 }] }, 't');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.total, 3, 'total harus tetap 3');
  assert.strictEqual(r.body.diubah, 1);
  assert.strictEqual(r.body.ditambah, 0);
  const data = p.ambil('kefa', 'items');
  assert.strictEqual(data.length, 3);
  const b = data.find((x) => x.kode === 'B');
  assert.strictEqual(b.stok, 99, 'stok B harus terbarui');
});

uji('delta bisa menambah item baru', () => {
  const p = buatPenerima({ token: 't' });
  p.terima({ toko: 'kefa', jenis: 'items', data: [{ kode: 'A' }] }, 't');
  const r = p.terima({ toko: 'kefa', jenis: 'items-ubah', data: [{ kode: 'Z' }] }, 't');
  assert.strictEqual(r.body.total, 2);
  assert.strictEqual(r.body.ditambah, 1);
});

uji('delta memperbarui waktu terima (data dianggap segar)', () => {
  // Batas katalog disetel eksplisit: sejak batas dipisah, `batasSegarDetik`
  // hanya mengatur laporan sehingga tidak lagi berpengaruh pada katalog.
  const p = buatPenerima({ token: 't', batasSegarItemsDetik: 60 });
  p.terima({ toko: 'kefa', jenis: 'items', data: [{ kode: 'A' }] }, 't');
  p._mundurkanWaktu('kefa', 'items', 120000);
  assert.strictEqual(p.status('kefa').items.segar, false);
  p.terima({ toko: 'kefa', jenis: 'items-ubah', data: [{ kode: 'A', v: 2 }] }, 't');
  assert.strictEqual(p.status('kefa').items.segar, true, 'delta harus menyegarkan');
});

uji('delta berulang tidak menumpuk duplikat', () => {
  const p = buatPenerima({ token: 't' });
  p.terima({ toko: 'kefa', jenis: 'items', data: [{ kode: 'A', v: 1 }] }, 't');
  p.terima({ toko: 'kefa', jenis: 'items-ubah', data: [{ kode: 'A', v: 2 }] }, 't');
  p.terima({ toko: 'kefa', jenis: 'items-ubah', data: [{ kode: 'A', v: 3 }] }, 't');
  const data = p.ambil('kefa', 'items');
  assert.strictEqual(data.length, 1, 'tidak boleh ada duplikat');
  assert.strictEqual(data[0].v, 3);
});

uji('kode tidak peka huruf besar/kecil', () => {
  const p = buatPenerima({ token: 't' });
  p.terima({ toko: 'kefa', jenis: 'items', data: [{ kode: 'abc', v: 1 }] }, 't');
  p.terima({ toko: 'kefa', jenis: 'items-ubah', data: [{ kode: 'ABC', v: 2 }] }, 't');
  const data = p.ambil('kefa', 'items');
  assert.strictEqual(data.length, 1);
  assert.strictEqual(data[0].v, 2);
});

uji('delta kosong ditolak', () => {
  const p = buatPenerima({ token: 't' });
  p.terima({ toko: 'kefa', jenis: 'items', data: [{ kode: 'A' }] }, 't');
  const r = p.terima({ toko: 'kefa', jenis: 'items-ubah', data: [] }, 't');
  assert.strictEqual(r.status, 400);
});

uji('item tanpa kode diabaikan, tidak membuat entri sampah', () => {
  const p = buatPenerima({ token: 't' });
  p.terima({ toko: 'kefa', jenis: 'items', data: [{ kode: 'A' }] }, 't');
  const r = p.terima({ toko: 'kefa', jenis: 'items-ubah', data: [{ kode: '' }, { kode: 'B' }] }, 't');
  assert.strictEqual(r.body.total, 2);
});

console.log('\n  lulus ' + lulus + '/' + (lulus + gagal));
if (gagal) { console.log('  ADA YANG GAGAL'); process.exit(1); }
console.log('  SEMUA LULUS');

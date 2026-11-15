'use strict';
/**
 * Uji DETEKSI PERUBAHAN STOK DI SISI AGEN.
 *
 * KENAPA UJI INI ADA
 * ------------------
 * Ditemukan cacat nyata di proxy lokal (C:\Users\rdpadmin\ipos-api\server.js):
 *
 *   baris 124-125: perubahan item dideteksi HANYA dari
 *                  nama / satuan / harga / harga2 / hpp / statusjual
 *                  -> `stok` TIDAK PERNAH dibandingkan
 *   baris 122-126: perbandingan berjalan SEBELUM stok diisi (baris 129-133),
 *                  jadi saat dibandingkan stok semua item masih 0
 *
 * Artinya `broadcast('items')` tidak pernah terpicu oleh penjualan. Dibuktikan
 * dengan probe SSE 31 menit: 3 frame `jual` masuk, frame `items` NOL.
 *
 * Kalau agen hanya mengandalkan SSE, stok tidak akan pernah realtime dan
 * penjualan baru sampai ke Railway saat katalog penuh berikutnya (15 menit) —
 * persis keluhan "tidak update".
 *
 * Uji ini mengunci perilaku pengganti: agen membandingkan stok sendiri.
 */
const assert = require('assert');

let lulus = 0, gagal = 0;
const uji = (nama, fn) => {
  try { fn(); lulus++; console.log('  OK    ' + nama); }
  catch (e) { gagal++; console.log('  GAGAL ' + nama + ' -> ' + e.message); }
};

/**
 * Tiruan logika inti `kirimSelisihStok` (pembanding stok).
 * Disalin sebagai fungsi murni supaya bisa diuji tanpa jaringan.
 */
function hitungDelta(items, stokTerakhir) {
  const delta = [];
  for (const it of items) {
    if (!it || !it.kode) continue;
    const k = String(it.kode).toUpperCase();
    const stokBaru = Number(it.stok);
    const stokLama = stokTerakhir.get(k);
    if (stokLama === undefined) { stokTerakhir.set(k, stokBaru); continue; }
    if (stokLama !== stokBaru) { stokTerakhir.set(k, stokBaru); delta.push(it); }
  }
  return delta;
}

console.log('=== uji deteksi perubahan stok ===');

uji('perubahan stok TERDETEKSI (inti keluhan realtime)', () => {
  const peta = new Map();
  // Kiriman pertama: hanya mencatat dasar, bukan delta.
  let d = hitungDelta([{ kode: 'A', stok: 10 }], peta);
  assert.strictEqual(d.length, 0, 'kiriman pertama bukan delta');
  // Penjualan: stok 10 -> 7
  d = hitungDelta([{ kode: 'A', stok: 7 }], peta);
  assert.strictEqual(d.length, 1, 'stok berubah harus jadi delta');
  assert.strictEqual(d[0].stok, 7);
});

uji('stok tidak berubah -> TIDAK mengirim apa pun (hemat bandwidth)', () => {
  const peta = new Map();
  hitungDelta([{ kode: 'A', stok: 10 }, { kode: 'B', stok: 5 }], peta);
  const d = hitungDelta([{ kode: 'A', stok: 10 }, { kode: 'B', stok: 5 }], peta);
  assert.strictEqual(d.length, 0);
});

uji('hanya item yang berubah yang dikirim, bukan seluruh katalog', () => {
  const peta = new Map();
  const katalog = [];
  for (let i = 0; i < 100; i++) katalog.push({ kode: 'K' + i, stok: 50 });
  hitungDelta(katalog, peta);
  katalog[42].stok = 49; // satu penjualan
  const d = hitungDelta(katalog, peta);
  assert.strictEqual(d.length, 1, 'hanya 1 item, bukan 100');
  assert.strictEqual(d[0].kode, 'K42');
});

uji('beberapa penjualan sekaligus -> semua terdeteksi', () => {
  const peta = new Map();
  hitungDelta([{ kode: 'A', stok: 10 }, { kode: 'B', stok: 10 }, { kode: 'C', stok: 10 }], peta);
  const d = hitungDelta([{ kode: 'A', stok: 8 }, { kode: 'B', stok: 10 }, { kode: 'C', stok: 7 }], peta);
  assert.strictEqual(d.length, 2);
  assert.deepStrictEqual(d.map((x) => x.kode).sort(), ['A', 'C']);
});

uji('stok berubah ke 0 tetap terdeteksi (barang habis itu penting)', () => {
  const peta = new Map();
  hitungDelta([{ kode: 'A', stok: 5 }], peta);
  const d = hitungDelta([{ kode: 'A', stok: 0 }], peta);
  assert.strictEqual(d.length, 1, 'stok 0 harus terkirim, bukan dianggap kosong');
  assert.strictEqual(d[0].stok, 0);
});

uji('kode tidak peka huruf besar/kecil', () => {
  const peta = new Map();
  hitungDelta([{ kode: 'abc', stok: 5 }], peta);
  const d = hitungDelta([{ kode: 'ABC', stok: 3 }], peta);
  assert.strictEqual(d.length, 1, 'kode sama harus dikenali meski beda kapital');
});

uji('item tanpa kode diabaikan, tidak membuat entri sampah', () => {
  const peta = new Map();
  hitungDelta([{ kode: '', stok: 1 }, { kode: null, stok: 2 }], peta);
  assert.strictEqual(peta.size, 0);
});

uji('item baru (belum pernah ada) tidak langsung jadi delta', () => {
  const peta = new Map();
  hitungDelta([{ kode: 'A', stok: 1 }], peta);
  // Item B baru muncul: katalog penuh berikutnya yang akan membawanya.
  const d = hitungDelta([{ kode: 'A', stok: 1 }, { kode: 'B', stok: 9 }], peta);
  assert.strictEqual(d.length, 0, 'item baru bukan "perubahan stok"');
  assert.strictEqual(peta.get('B'), 9, 'tapi dasarnya harus dicatat');
});

uji('perubahan beruntun terdeteksi bertahap', () => {
  const peta = new Map();
  hitungDelta([{ kode: 'A', stok: 10 }], peta);
  assert.strictEqual(hitungDelta([{ kode: 'A', stok: 9 }], peta).length, 1);
  assert.strictEqual(hitungDelta([{ kode: 'A', stok: 8 }], peta).length, 1);
  assert.strictEqual(hitungDelta([{ kode: 'A', stok: 7 }], peta).length, 1);
});

uji('stok desimal (bukan bilangan bulat) tetap terdeteksi', () => {
  const peta = new Map();
  hitungDelta([{ kode: 'A', stok: 10.5 }], peta);
  const d = hitungDelta([{ kode: 'A', stok: 10.25 }], peta);
  assert.strictEqual(d.length, 1);
});

console.log('\n  lulus ' + lulus + '/' + (lulus + gagal));
if (gagal) { console.log('  ADA YANG GAGAL'); process.exit(1); }
console.log('  SEMUA LULUS');

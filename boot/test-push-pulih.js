'use strict';
/**
 * Uji PEMULIHAN SETELAH REDEPLOY.
 *
 * Kenapa ini penting: penyimpanan penerima hanya di MEMORI. Setiap redeploy
 * atau restart Railway mengosongkannya. Tanpa jalur pemulihan cepat, PC baru
 * mengirim ulang katalog saat jeda penuh berikutnya (15 menit) — dan selama
 * itu bot melayani toko tanpa data sama sekali.
 *
 * Ini persis keluhan "data tidak update" yang bisa muncul lagi setiap deploy.
 * Jadi bukan kasus pinggiran: ini terjadi di SETIAP deploy.
 */
const assert = require('assert');
const { buatPenerima } = require('./push-penerima');

let lulus = 0, gagal = 0;
const uji = (nama, fn) => {
  try { fn(); lulus++; console.log('  OK    ' + nama); }
  catch (e) { gagal++; console.log('  GAGAL ' + nama + ' -> ' + e.message); }
};

console.log('=== uji pemulihan setelah redeploy ===');

uji('server kosong -> denyut menjawab perluPenuh:true', () => {
  const p = buatPenerima({ token: 't' });
  const r = p.terima({ toko: 'kefa', jenis: 'denyut' }, 't');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.perluPenuh, true, 'server kosong harus minta katalog penuh');
});

uji('server sudah punya katalog -> denyut TIDAK minta penuh', () => {
  const p = buatPenerima({ token: 't' });
  p.terima({ toko: 'kefa', jenis: 'items', data: [{ kode: 'A' }] }, 't');
  const r = p.terima({ toko: 'kefa', jenis: 'denyut' }, 't');
  assert.strictEqual(r.body.perluPenuh, false,
    'jangan minta katalog penuh terus-menerus: 780 KB tiap 30 dtk itu boros');
});

uji('perluPenuh berlaku per toko (kefa kosong, cp terisi)', () => {
  const p = buatPenerima({ token: 't' });
  p.terima({ toko: 'cp', jenis: 'items', data: [{ kode: 'X' }] }, 't');
  assert.strictEqual(p.terima({ toko: 'kefa', jenis: 'denyut' }, 't').body.perluPenuh, true);
  assert.strictEqual(p.terima({ toko: 'cp', jenis: 'denyut' }, 't').body.perluPenuh, false);
});

uji('delta tanpa katalog tetap 409 (jalur pemulihan kedua)', () => {
  const p = buatPenerima({ token: 't' });
  const r = p.terima({ toko: 'kefa', jenis: 'items-ubah', data: [{ kode: 'A' }] }, 't');
  assert.strictEqual(r.status, 409);
});

uji('setelah katalog dikirim, denyut berhenti minta penuh', () => {
  const p = buatPenerima({ token: 't' });
  assert.strictEqual(p.terima({ toko: 'kefa', jenis: 'denyut' }, 't').body.perluPenuh, true);
  p.terima({ toko: 'kefa', jenis: 'items', data: [{ kode: 'A' }] }, 't');
  assert.strictEqual(p.terima({ toko: 'kefa', jenis: 'denyut' }, 't').body.perluPenuh, false);
});

console.log('\n  lulus ' + lulus + '/' + (lulus + gagal));
if (gagal) { console.log('  ADA YANG GAGAL'); process.exit(1); }
console.log('  SEMUA LULUS');

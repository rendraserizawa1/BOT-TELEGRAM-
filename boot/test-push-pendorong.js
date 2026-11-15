'use strict';
/**
 * Uji pendorong iPos (sisi PC) — tanpa jaringan nyata.
 *
 * Yang dijaga:
 *  - hanya mendorong bila data BERUBAH (hemat kuota, tidak membebani server)
 *  - kegagalan jaringan TIDAK menghentikan pendorong (coba lagi siklus berikut)
 *  - token tidak pernah dicetak
 *  - 401/400 dianggap kesalahan tetap -> berhenti, jangan spam server
 */
const assert = require('assert');
const { buatPendorong } = require('./push-pendorong');

let lulus = 0, gagal = 0;
const ujiAsync = async (nama, fn) => {
  try { await fn(); lulus++; console.log('  OK    ' + nama); }
  catch (e) { gagal++; console.log('  GAGAL ' + nama + ' -> ' + e.message); }
};

(async () => {
  console.log('=== uji pendorong iPos ===');

  await ujiAsync('mendorong items saat pertama kali', async () => {
    const dikirim = [];
    const p = buatPendorong({
      url: 'http://server/ipos/push', token: 't', toko: 'kefa',
      _kirim: async (u, isi) => { dikirim.push(isi); return { status: 200, body: { ok: true } }; },
      _ambilSumber: async (jenis) => (jenis === 'items' ? [{ kode: 'A' }] : { nota: 1 }),
    });
    const h = await p.siklus();
    assert.ok(h.items.dikirim, 'items harus dikirim pada siklus pertama');
  });

  await ujiAsync('TIDAK mendorong ulang bila data sama', async () => {
    const dikirim = [];
    const p = buatPendorong({
      url: 'http://server/ipos/push', token: 't', toko: 'kefa',
      _kirim: async (u, isi) => { dikirim.push(isi); return { status: 200, body: { ok: true } }; },
      _ambilSumber: async (jenis) => (jenis === 'items' ? [{ kode: 'A' }] : { nota: 1 }),
    });
    await p.siklus();
    const n1 = dikirim.length;
    await p.siklus();
    assert.strictEqual(dikirim.length, n1, 'siklus kedua tidak boleh mengirim ulang data yang sama');
  });

  await ujiAsync('mendorong ulang saat data berubah', async () => {
    const dikirim = [];
    let versi = 0;
    const p = buatPendorong({
      url: 'http://server/ipos/push', token: 't', toko: 'kefa',
      _kirim: async (u, isi) => { dikirim.push(isi); return { status: 200, body: { ok: true } }; },
      _ambilSumber: async (jenis) => (jenis === 'items' ? [{ kode: 'A', v: versi }] : { nota: 1 }),
    });
    await p.siklus();
    const n1 = dikirim.length;
    versi = 1;
    await p.siklus();
    assert.ok(dikirim.length > n1, 'perubahan data harus memicu kiriman baru');
  });

  await ujiAsync('kegagalan jaringan tidak melempar, dicatat sebagai gagal', async () => {
    const p = buatPendorong({
      url: 'http://server/ipos/push', token: 't', toko: 'kefa',
      _kirim: async () => { const e = new Error('fetch failed'); e.code = 'ECONNRESET'; throw e; },
      _ambilSumber: async (jenis) => (jenis === 'items' ? [{ kode: 'A' }] : { nota: 1 }),
    });
    const h = await p.siklus(); // tidak boleh melempar
    assert.ok(h.items.gagal, 'harus ditandai gagal');
  });

  await ujiAsync('401 -> berhenti mencoba (salah konfigurasi, jangan spam)', async () => {
    let n = 0;
    const p = buatPendorong({
      url: 'http://server/ipos/push', token: 'salah', toko: 'kefa',
      _kirim: async () => { n++; return { status: 401, body: { ok: false } }; },
      _ambilSumber: async (jenis) => (jenis === 'items' ? [{ kode: 'A' }] : { nota: 1 }),
    });
    await p.siklus();
    const n1 = n;
    await p.siklus();
    assert.strictEqual(n, n1, 'setelah 401 tidak boleh terus mencoba');
    assert.ok(p.status().berhenti, 'status harus melaporkan berhenti');
  });

  await ujiAsync('sumber gagal diambil -> tidak mengirim apa pun', async () => {
    const dikirim = [];
    const p = buatPendorong({
      url: 'http://server/ipos/push', token: 't', toko: 'kefa',
      _kirim: async (u, isi) => { dikirim.push(isi); return { status: 200, body: { ok: true } }; },
      _ambilSumber: async () => { throw new Error('sumber mati'); },
    });
    await p.siklus();
    assert.strictEqual(dikirim.length, 0);
  });

  await ujiAsync('status tidak memuat token', async () => {
    const p = buatPendorong({
      url: 'http://server/ipos/push', token: 'rahasia-sekali', toko: 'kefa',
      _kirim: async () => ({ status: 200, body: { ok: true } }),
      _ambilSumber: async (jenis) => (jenis === 'items' ? [{ kode: 'A' }] : { nota: 1 }),
    });
    await p.siklus();
    const teks = JSON.stringify(p.status());
    assert.ok(!teks.includes('rahasia-sekali'), 'token bocor di status');
  });

  console.log('\n  lulus ' + lulus + '/' + (lulus + gagal));
  if (gagal) { console.log('  ADA YANG GAGAL'); process.exit(1); }
  console.log('  SEMUA LULUS');
})();

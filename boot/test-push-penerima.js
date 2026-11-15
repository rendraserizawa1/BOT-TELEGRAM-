'use strict';
/**
 * Uji endpoint penerima dorongan iPos (PUSH_RECEIVER).
 *
 * KENAPA ARSITEKTUR INI
 * ---------------------
 * Tailscale terbukti tidak layak: node Railway tidak punya jalur langsung ke
 * PC (CGNAT), jadi semua trafik lewat DERP relay -> SOCKS5 timeout intermiten
 * dan koneksi putus-putus. Sebaliknya PC -> Railway lewat HTTPS publik terukur
 * 780 KB dalam 0,81 detik. Jadi arahnya dibalik: PC yang MENDORONG.
 *
 * Uji ini TIDAK menyalakan bot dan TIDAK menyentuh jaringan:
 * ia menguji logika murni (validasi, penyimpanan, kesegaran, token).
 */
const assert = require('assert');
const { buatPenerima } = require('./push-penerima');

let lulus = 0, gagal = 0;
const uji = (nama, fn) => {
  try { fn(); lulus++; console.log('  OK    ' + nama); }
  catch (e) { gagal++; console.log('  GAGAL ' + nama + ' -> ' + e.message); }
};
const ujiAsync = async (nama, fn) => {
  try { await fn(); lulus++; console.log('  OK    ' + nama); }
  catch (e) { gagal++; console.log('  GAGAL ' + nama + ' -> ' + e.message); }
};

(async () => {
  console.log('=== uji penerima dorongan iPos ===');

  // ── Token ────────────────────────────────────────────────────────────
  uji('tanpa token -> tolak (jangan pernah terbuka)', () => {
    const p = buatPenerima({ token: '' });
    const r = p.terima({ toko: 'kefa', jenis: 'items', data: [] });
    assert.strictEqual(r.status, 503);
  });

  uji('token salah -> 401', () => {
    const p = buatPenerima({ token: 'rahasia-benar' });
    const r = p.terima({ toko: 'kefa', jenis: 'items', data: [] }, 'token-palsu');
    assert.strictEqual(r.status, 401);
  });

  uji('token benar -> diterima', () => {
    const p = buatPenerima({ token: 'rahasia-benar' });
    const r = p.terima({ toko: 'kefa', jenis: 'items', data: [{ kode: 'A' }] }, 'rahasia-benar');
    assert.strictEqual(r.status, 200);
  });

  // ── Validasi bentuk ──────────────────────────────────────────────────
  uji('toko tak dikenal -> 400', () => {
    const p = buatPenerima({ token: 't' });
    const r = p.terima({ toko: 'entah', jenis: 'items', data: [] }, 't');
    assert.strictEqual(r.status, 400);
  });

  uji('jenis tak dikenal -> 400', () => {
    const p = buatPenerima({ token: 't' });
    const r = p.terima({ toko: 'kefa', jenis: 'entah', data: [] }, 't');
    assert.strictEqual(r.status, 400);
  });

  uji('data bukan array (items) -> 400', () => {
    const p = buatPenerima({ token: 't' });
    const r = p.terima({ toko: 'kefa', jenis: 'items', data: { a: 1 } }, 't');
    assert.strictEqual(r.status, 400);
  });

  uji('data items kosong -> 400 (jangan timpa data bagus dengan kosong)', () => {
    const p = buatPenerima({ token: 't' });
    const r = p.terima({ toko: 'kefa', jenis: 'items', data: [] }, 't');
    assert.strictEqual(r.status, 400);
  });

  // ── Penyimpanan & kesegaran ──────────────────────────────────────────
  uji('items tersimpan dan dilaporkan segar', () => {
    const p = buatPenerima({ token: 't' });
    p.terima({ toko: 'kefa', jenis: 'items', data: [{ kode: 'A' }, { kode: 'B' }] }, 't');
    const s = p.status('kefa');
    assert.strictEqual(s.items.total, 2);
    assert.strictEqual(s.items.segar, true);
    assert.ok(s.items.umurDetik !== null && s.items.umurDetik < 5);
  });

  uji('laporan tersimpan terpisah dari items', () => {
    const p = buatPenerima({ token: 't' });
    p.terima({ toko: 'kefa', jenis: 'items', data: [{ kode: 'A' }] }, 't');
    p.terima({ toko: 'kefa', jenis: 'jual', data: { nota: 43, omzet: 9769500 } }, 't');
    const s = p.status('kefa');
    assert.strictEqual(s.items.total, 1);
    assert.strictEqual(s.jual.nota, 43);
    assert.strictEqual(s.jual.segar, true);
  });

  uji('data basi ditandai tidak segar', () => {
    // Katalog punya batas sendiri (default 1200 dtk), jadi uji ini harus
    // menyetelnya eksplisit. Dulu `batasSegarDetik` mengatur katalog juga;
    // sejak batas dipisah, memakai nama itu akan menguji hal yang salah.
    const p = buatPenerima({ token: 't', batasSegarItemsDetik: 60 });
    p.terima({ toko: 'kefa', jenis: 'items', data: [{ kode: 'A' }] }, 't');
    // Mundurkan waktu terima 120 detik.
    p._mundurkanWaktu('kefa', 'items', 120000);
    const s = p.status('kefa');
    assert.strictEqual(s.items.segar, false);
    assert.ok(s.items.umurDetik >= 120);
  });

  uji('toko belum pernah menerima -> status null, bukan crash', () => {
    const p = buatPenerima({ token: 't' });
    const s = p.status('nk');
    assert.strictEqual(s.items, null);
    assert.strictEqual(s.jual, null);
  });

  uji('push berulang menimpa, tidak menumpuk', () => {
    const p = buatPenerima({ token: 't' });
    p.terima({ toko: 'kefa', jenis: 'items', data: [{ kode: 'A' }] }, 't');
    p.terima({ toko: 'kefa', jenis: 'items', data: [{ kode: 'B' }, { kode: 'C' }, { kode: 'D' }] }, 't');
    assert.strictEqual(p.status('kefa').items.total, 3);
  });

  uji('hitungan push dilaporkan (bukti aliran hidup)', () => {
    const p = buatPenerima({ token: 't' });
    p.terima({ toko: 'kefa', jenis: 'items', data: [{ kode: 'A' }] }, 't');
    p.terima({ toko: 'kefa', jenis: 'items', data: [{ kode: 'A' }] }, 't');
    const s = p.status('kefa');
    assert.strictEqual(s.items.jumlahPush, 2);
  });

  uji('token tidak pernah muncul di status', () => {
    const p = buatPenerima({ token: 'rahasia-sekali' });
    p.terima({ toko: 'kefa', jenis: 'items', data: [{ kode: 'A' }] }, 'rahasia-sekali');
    const teks = JSON.stringify(p.status('kefa'));
    assert.ok(!teks.includes('rahasia-sekali'), 'token bocor di status');
  });

  console.log('\n  lulus ' + lulus + '/' + (lulus + gagal));
  if (gagal) { console.log('  ADA YANG GAGAL'); process.exit(1); }
  console.log('  SEMUA LULUS');
})();

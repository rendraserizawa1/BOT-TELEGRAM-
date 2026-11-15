'use strict';
/**
 * Uji modul jalur iPos — TANPA jaringan nyata.
 *
 * Yang dijaga di sini:
 *  - tanpa proxy, perilaku harus SAMA seperti `fetch` biasa (fallback aman)
 *  - pindah ke cadangan HANYA saat error jaringan, BUKAN saat 404/401
 *  - setelah cadangan berhasil, jalur diingat (tidak mencoba-coba terus)
 *  - bila cadangan juga gagal, error asli dilempar (jangan menelan error)
 */
const assert = require('assert');
const { buatJalurIpos } = require('./ipos-jalur');

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
  console.log('=== uji ipos-jalur ===');

  uji('tanpa proxy -> dispatcher null', () => {
    const j = buatJalurIpos({ urlUtama: 'http://x/ipos', urlCadangan: '', proxy: '' });
    assert.strictEqual(j.dispatcher(), null);
  });

  uji('status melaporkan proxyAktif=false tanpa proxy', () => {
    const j = buatJalurIpos({ urlUtama: 'http://x/ipos', urlCadangan: '', proxy: '' });
    const s = j.status();
    assert.strictEqual(s.proxyAktif, false);
    assert.strictEqual(s.urlUtama, 'http://x/ipos');
    assert.strictEqual(s.urlCadangan, null);
    assert.strictEqual(s.jalurDipakai, null);
  });

  uji('status melaporkan urlCadangan bila diisi', () => {
    const j = buatJalurIpos({ urlUtama: 'http://a/ipos', urlCadangan: 'http://b/ipos', proxy: '' });
    assert.strictEqual(j.status().urlCadangan, 'http://b/ipos');
  });

  await ujiAsync('error jaringan -> pindah ke cadangan', async () => {
    const dipanggil = [];
    const j = buatJalurIpos({
      urlUtama: 'http://utama/ipos', urlCadangan: 'http://cadangan/ipos', proxy: '',
      _fetch: async (url) => {
        dipanggil.push(url);
        if (url.startsWith('http://utama')) throw new TypeError('fetch failed');
        return { status: 200, ok: true, url };
      },
    });
    const r = await j.ambil('http://utama/ipos/api/items');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(dipanggil.length, 2);
    assert.ok(dipanggil[1].startsWith('http://cadangan'), 'panggilan kedua harus ke cadangan');
    assert.strictEqual(j.status().jalurDipakai, 'cadangan');
  });

  await ujiAsync('HTTP 404 TIDAK memicu cadangan', async () => {
    const dipanggil = [];
    const j = buatJalurIpos({
      urlUtama: 'http://utama/ipos', urlCadangan: 'http://cadangan/ipos', proxy: '',
      _fetch: async (url) => { dipanggil.push(url); return { status: 404, ok: false }; },
    });
    const r = await j.ambil('http://utama/ipos/api/item?kode=X');
    assert.strictEqual(r.status, 404);
    assert.strictEqual(dipanggil.length, 1);
  });

  await ujiAsync('HTTP 500 juga TIDAK memicu cadangan', async () => {
    const dipanggil = [];
    const j = buatJalurIpos({
      urlUtama: 'http://utama/ipos', urlCadangan: 'http://cadangan/ipos', proxy: '',
      _fetch: async (url) => { dipanggil.push(url); return { status: 500, ok: false }; },
    });
    const r = await j.ambil('http://utama/ipos/api/jual');
    assert.strictEqual(r.status, 500);
    assert.strictEqual(dipanggil.length, 1);
  });

  await ujiAsync('setelah cadangan berhasil, jalur diingat', async () => {
    let utama = 0;
    const j = buatJalurIpos({
      urlUtama: 'http://utama/ipos', urlCadangan: 'http://cadangan/ipos', proxy: '',
      _fetch: async (url) => {
        if (url.startsWith('http://utama')) { utama++; throw new TypeError('fetch failed'); }
        return { status: 200, ok: true };
      },
    });
    await j.ambil('http://utama/ipos/api/items');
    await j.ambil('http://utama/ipos/api/jual');
    assert.strictEqual(utama, 1, 'utama hanya boleh dicoba sekali');
  });

  await ujiAsync('cadangan juga gagal -> error dilempar', async () => {
    const j = buatJalurIpos({
      urlUtama: 'http://utama/ipos', urlCadangan: 'http://cadangan/ipos', proxy: '',
      _fetch: async () => { throw new TypeError('fetch failed'); },
    });
    await assert.rejects(() => j.ambil('http://utama/ipos/api/items'), /fetch failed/);
  });

  await ujiAsync('AbortError TIDAK memicu cadangan', async () => {
    const dipanggil = [];
    const j = buatJalurIpos({
      urlUtama: 'http://utama/ipos', urlCadangan: 'http://cadangan/ipos', proxy: '',
      _fetch: async (url) => {
        dipanggil.push(url);
        const e = new Error('This operation was aborted');
        e.name = 'AbortError';
        throw e;
      },
    });
    await assert.rejects(() => j.ambil('http://utama/ipos/api/items'));
    assert.strictEqual(dipanggil.length, 1, 'abort bukan alasan pindah jalur');
  });

  await ujiAsync('ECONNRESET memicu cadangan', async () => {
    const dipanggil = [];
    const j = buatJalurIpos({
      urlUtama: 'http://utama/ipos', urlCadangan: 'http://cadangan/ipos', proxy: '',
      _fetch: async (url) => {
        dipanggil.push(url);
        if (url.startsWith('http://utama')) { const e = new Error('read ECONNRESET'); e.code = 'ECONNRESET'; throw e; }
        return { status: 200, ok: true };
      },
    });
    const r = await j.ambil('http://utama/ipos/api/items');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(dipanggil.length, 2);
  });

  await ujiAsync('tanpa cadangan: error langsung dilempar, tidak diulang', async () => {
    const dipanggil = [];
    const j = buatJalurIpos({
      urlUtama: 'http://utama/ipos', urlCadangan: '', proxy: '',
      _fetch: async (url) => { dipanggil.push(url); throw new TypeError('fetch failed'); },
    });
    await assert.rejects(() => j.ambil('http://utama/ipos/api/items'), /fetch failed/);
    assert.strictEqual(dipanggil.length, 1);
  });

  console.log('\n  lulus ' + lulus + '/' + (lulus + gagal));
  if (gagal) { console.log('  ADA YANG GAGAL'); process.exit(1); }
  console.log('  SEMUA LULUS');
})();

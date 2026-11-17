'use strict';
/**
 * UJI: SEBAB KEBEKUAN HARUS IKUT TERKIRIM — TETAPI TIDAK DIBEBANKAN SAAT SEGAR.
 *
 * MASALAH YANG DIUJI
 * ------------------
 * Proxy melaporkan galat DB-nya di `/health` (`jual.err`), BUKAN di respons
 * `/api/jual`. Jadi laporan yang dikirim ke bot hanya membawa angka beku tanpa
 * sebab. Pengguna lalu hanya tahu "laporan beku", tanpa tahu apa yang harus
 * diperbaiki — padahal sebabnya (rute DB di mesin toko vs bug proxy) menentukan
 * siapa yang harus bertindak.
 *
 * YANG DIBUKTIKAN
 * ---------------
 *  1. Laporan BEKU -> `updateSebab` ditempelkan dari `/health` `jual.err`.
 *  2. Laporan SEGAR -> `updateSebab` TIDAK ditempelkan, dan `/health` TIDAK
 *     dipanggil sama sekali (tidak membebani mesin toko tiap menit).
 *  3. Galat saat mengambil sebab TIDAK menggagalkan pengiriman laporan —
 *     sebab hanya pelengkap.
 *  4. Satuan `update` detik maupun milidetik sama-sama dikenali.
 *  5. `update` tidak ada / bukan angka -> tidak menempel, tidak melempar.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SUMBER = fs.readFileSync(path.join(__dirname, 'push-agen.js'), 'utf8');

function ekstrak(nama) {
  const mulai = SUMBER.indexOf('async function ' + nama + '(');
  assert.ok(mulai >= 0, 'fungsi ' + nama + ' tidak ditemukan di push-agen.js');
  let i = SUMBER.indexOf('{', mulai);
  let dalam = 0;
  for (; i < SUMBER.length; i++) {
    if (SUMBER[i] === '{') dalam++;
    else if (SUMBER[i] === '}') { dalam--; if (dalam === 0) { i++; break; } }
  }
  return SUMBER.slice(mulai, i);
}

/**
 * Bangun fungsi asli dengan `ambilJson` tiruan yang MENCATAT setiap URL.
 * Dengan begitu bisa dibuktikan berapa permintaan yang benar-benar terjadi —
 * bukan sekadar "kelihatannya hemat".
 */
function buat(ambilJsonTiruan) {
  const badan = ekstrak('tempelSebabBilaBeku');
  // eslint-disable-next-line no-new-func
  return new Function('ambilJson', badan + '\nreturn tempelSebabBilaBeku;')(ambilJsonTiruan);
}

let lulus = 0, gagal = 0;
function uji(nama, fn) {
  return fn().then(
    () => { lulus++; console.log('  OK   ' + nama); },
    (e) => { gagal++; console.log('  GAGAL ' + nama + ' -> ' + e.message); },
  );
}

const toko = { url: 'http://contoh:8080/ipos', key: 'rahasia' };
const bekuMs = Date.now() - 92 * 60 * 1000;   // 92 menit lalu
const segarMs = Date.now() - 5 * 1000;        // 5 detik lalu

(async () => {
  console.log('=== uji tempelSebabBilaBeku ===');

  await uji('laporan BEKU -> sebab ditempelkan dari /health', async () => {
    const url = [];
    const fn = buat(async (u) => {
      url.push(u);
      return { jual: { err: 'connect ENETUNREACH 192.168.77.250:5444' } };
    });
    const lap = { update: bekuMs, total: { nota: 18 } };
    const hasil = await fn(toko, lap);
    assert.strictEqual(hasil.updateSebab, 'connect ENETUNREACH 192.168.77.250:5444');
    assert.strictEqual(url.length, 1, 'harus memanggil /health tepat 1x');
    assert.ok(url[0].includes('/health'), 'yang dipanggil harus /health');
    // Angka laporan tidak boleh dirusak oleh fungsi ini.
    assert.strictEqual(hasil.total.nota, 18, 'isi laporan tidak boleh berubah');
  });

  await uji('laporan SEGAR -> sebab TIDAK ditempel, /health TIDAK dipanggil', async () => {
    const url = [];
    const fn = buat(async (u) => {
      url.push(u);
      return { jual: { err: 'tidak boleh terpakai' } };
    });
    const lap = { update: segarMs, total: { nota: 5 } };
    const hasil = await fn(toko, lap);
    assert.strictEqual(hasil.updateSebab, undefined,
      'laporan segar tidak boleh diberi cap "sebab" — itu menyesatkan');
    assert.strictEqual(url.length, 0,
      'laporan segar TIDAK boleh memanggil /health (beban mesin toko tiap menit)');
  });

  await uji('galat saat ambil sebab -> laporan tetap dikirim, tidak melempar', async () => {
    const fn = buat(async () => { throw new Error('proxy mati'); });
    const lap = { update: bekuMs, total: { nota: 3 } };
    const hasil = await fn(toko, lap);
    assert.ok(hasil, 'harus mengembalikan laporan');
    assert.strictEqual(hasil.total.nota, 3, 'laporan tidak boleh hilang');
    assert.strictEqual(hasil.updateSebab, undefined, 'tanpa sebab bila gagal diambil');
  });

  await uji('/health tidak punya jual.err -> tidak menempel apa pun', async () => {
    const fn = buat(async () => ({ jual: { err: null } }));
    const hasil = await fn(toko, { update: bekuMs });
    assert.strictEqual(hasil.updateSebab, undefined);
  });

  await uji('update dalam DETIK tetap dikenali sebagai beku', async () => {
    const url = [];
    const fn = buat(async (u) => { url.push(u); return { jual: { err: 'sebab-detik' } }; });
    const hasil = await fn(toko, { update: Math.floor(bekuMs / 1000) });
    assert.strictEqual(hasil.updateSebab, 'sebab-detik',
      'update satuan detik harus dinormalkan; salah satuan = alarm palsu atau tidak menyala');
    assert.strictEqual(url.length, 1);
  });

  await uji('update tidak ada / bukan angka -> tidak menempel, tidak melempar', async () => {
    const url = [];
    const fn = buat(async (u) => { url.push(u); return { jual: { err: 'x' } }; });
    for (const lap of [{}, { update: null }, { update: 'abc' }, null]) {
      const hasil = await fn(toko, lap);
      if (lap) assert.strictEqual(hasil.updateSebab, undefined);
    }
    assert.strictEqual(url.length, 0, 'tanpa update tidak perlu memanggil /health');
  });

  await uji('sebab panjang dipotong (tidak membanjiri pesan Telegram)', async () => {
    const fn = buat(async () => ({ jual: { err: 'z'.repeat(400) } }));
    const hasil = await fn(toko, { update: bekuMs });
    assert.ok(hasil.updateSebab.length <= 120,
      'sebab harus dipotong <=120, dapat ' + hasil.updateSebab.length);
  });

  // ── Bagian 2: benar-benar dipakai oleh pengiriman laporan ──────────────
  console.log('');
  console.log('=== uji: pengiriman laporan memakai fungsi itu ===');
  await uji('kirimLaporan memanggil tempelSebabBilaBeku', async () => {
    assert.ok(/await tempelSebabBilaBeku\(t, j\)/.test(SUMBER),
      'kirimLaporan HARUS memakai tempelSebabBilaBeku — tanpa itu sebabnya tidak pernah sampai');
  });

  console.log('');
  console.log('  lulus ' + lulus + '/' + (lulus + gagal));
  if (gagal) { console.log('  ADA YANG GAGAL'); process.exit(1); }
  console.log('  SEMUA LULUS');
})();

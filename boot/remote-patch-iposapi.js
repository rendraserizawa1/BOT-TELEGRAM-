'use strict';
/**
 * PATCH proxy iPos CP (ADMIN_DIMAS) — hentikan laporan penjualan yang mati permanen.
 *
 * KEJADIAN 2026-11-17 09:08
 * ------------------------
 * Laporan penjualan CP beku 2+ jam. Katalog tetap segar, /health proxy tetap
 * "ok", tetapi `update` laporan berhenti bertambah. err.log menunjukkan:
 *
 *   [unhandledRejection] Error: connect ENETUNREACH 192.168.77.250:5444
 *       at async Object.segarkanJendela (server.js:420:19)
 *       at async file:///.../server.js:1089:11
 *
 * Sebab: `segarkanJendela()` dipanggil di dalam `for (;;)` TANPA try/catch.
 * Satu kedipan jaringan ke DB melempar galat yang tidak tertangkap, sehingga
 * async IIFE pemelihara laporan itu MATI. Proses tetap hidup, katalog tetap
 * jalan — jadi tidak ada yang terlihat rusak kecuali angkanya yang membeku.
 * Hanya restart service yang memulihkannya.
 *
 * Ditambah lagi, "recovery" memanggil `pool.end()`. Setelah end(), pg.Pool
 * menolak SEMUA query berikutnya selamanya ("Cannot use a pool after calling
 * end"), sehingga gangguan sementara berubah menjadi kerusakan permanen.
 *
 * Semua penambat (anchor) di bawah HANYA berisi karakter ASCII, supaya
 * pencocokan tidak bergantung pada encoding berkas.
 */
const fs = require('fs');
const path = require('path');

const D = process.argv[2] || 'C:\\root folder project\\ipos-api';
const S = path.join(D, 'server.js');

const asli = fs.readFileSync(S, 'utf8');
let teks = asli;
const laporan = [];

function patch(nama, dari, ke, wajibSekali) {
  const n = teks.split(dari).length - 1;
  if (n === 0) throw new Error('PATCH ' + nama + ': pola TIDAK ditemukan');
  if (wajibSekali && n !== 1) throw new Error('PATCH ' + nama + ': pola muncul ' + n + 'x, harus 1x');
  teks = teks.replace(dari, ke);
  laporan.push('  OK   ' + nama + ' (pola muncul ' + n + 'x)');
}

// ── PATCH 1: buka try tepat setelah loop jual ──────────────────────────────
patch(
  '1. try{} untuk siklus loop jual',
  'let hariReload = -1, siklus = 0;\n      for (;;) {\n        const now = new Date();',
  'let hariReload = -1, siklus = 0;\n'
  + '      for (;;) {\n'
  + '        // TAHAN-GANGGUAN: SELURUH isi siklus dibungkus try/catch.\n'
  + '        //\n'
  + '        // KENAPA WAJIB (kejadian 2026-11-17 09:08, laporan CP beku 2+ jam):\n'
  + '        // segarkanJendela() dipanggil tanpa penjagaan. Saat jaringan ke DB\n'
  + '        // berkedip, pg melempar galat yang tidak tertangkap, sehingga async\n'
  + '        // IIFE ini MATI. Proses tetap hidup dan katalog tetap jalan, jadi\n'
  + '        // /health tampak sehat -- tetapi laporan penjualan berhenti selamanya\n'
  + '        // sampai service di-restart. Satu kedipan jaringan tidak boleh\n'
  + '        // mematikan fitur secara permanen.\n'
  + '        try {\n'
  + '        const now = new Date();',
  true,
);

// ── PATCH 2: tutup try/catch sebelum for(;;) berakhir ─────────────────────
patch(
  '2. catch{} penutup siklus loop jual',
  '      }\n    })();\n  }\n  server.listen(PORT, HOST,',
  '        } catch (e) {\n'
  + '          // JANGAN biarkan satu galat mematikan loop. Catat, beri jeda, lanjut.\n'
  + '          sumber.st.err = String((e && e.message) || e);\n'
  + "          console.error('[jual:' + sumber.id + '] siklus gagal: ' + sumber.st.err);\n"
  + '          await new Promise((r) => setTimeout(r, 3000));\n'
  + '        }\n'
  + '      }\n    })();\n  }\n  server.listen(PORT, HOST,',
  true,
);

// ── PATCH 3: hapus pool.end() yang merusak pool permanen ──────────────────
patch(
  '3. hapus pool.end() perusak',
  'try { await pool.end(); } catch {}',
  '// pool.end() SENGAJA TIDAK DIPANGGIL: setelah end(), pg.Pool menolak SEMUA\n'
  + '              // query berikutnya selamanya ("Cannot use a pool after calling end"),\n'
  + '              // sehingga gangguan sementara menjadi kerusakan permanen.',
  true,
);

if (teks === asli) throw new Error('Tidak ada perubahan');

fs.writeFileSync(S, teks, 'utf8');
console.log('=== PATCH DITERAPKAN ===');
for (const b of laporan) console.log(b);
console.log('  ukuran: ' + asli.length + ' -> ' + teks.length + ' karakter');

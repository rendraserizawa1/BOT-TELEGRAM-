'use strict';
// ════════════════════════════════════════════════════════════════════════
// UJI REGRESI: PENJAGA KESEGARAN DATA ITEM
//
// Bug yang dijaga: penjaga kesegaran dulu memakai `lastSseFrameAt`, yang juga
// diperbarui oleh `jual-ping`. CP mengirim jual-ping tiap ~15 dtk, sehingga
// penjaga TIDAK PERNAH aktif (kode mati) dan data harga/stok bisa tertinggal
// sampai sync berkala 5 menit.
//
// Uji ini memeriksa SUMBER KODE, karena perilaku waktunya sulit diuji tanpa
// menunggu berjam-jam:
//   1. status() memakai lastItemAt untuk umurItemDetik (bukan lastSseFrameAt).
//   2. Penjaga memakai lastItemAt/lastSync, BUKAN lastSseFrameAt.
//   3. `jual` (bukan jual-ping) memperbarui lastJualAt.
//   4. `items` memperbarui lastItemAt.
//   5. syncStok penuh memperbarui lastItemAt.
//   6. itemSegar ada di status() dan diteruskan ke /health.
// ════════════════════════════════════════════════════════════════════════
const fs = require('fs');

const BRIDGE = 'C:/BOT-TELEGRAM-/ipos-bridge.js';
const INDEX = 'C:/BOT-TELEGRAM-/index.js';
const src = fs.readFileSync(BRIDGE, 'utf8');
const idx = fs.readFileSync(INDEX, 'utf8');

let lulus = 0, gagal = 0;
function cek(nama, kondisi, bukti) {
  if (kondisi) { lulus++; console.log(`  ✅ ${nama}`); }
  else { gagal++; console.log(`  ❌ ${nama}${bukti ? '  → ' + bukti : ''}`); }
}

// Ambil blok fungsi berdasarkan penanda awal
function blok(teks, awal, akhir) {
  const i = teks.indexOf(awal);
  if (i < 0) return '';
  const j = teks.indexOf(akhir, i + awal.length);
  return j < 0 ? teks.slice(i) : teks.slice(i, j);
}

console.log('=== 1. Variabel pelacak ada ===');
cek('lastItemAt dideklarasikan', /let lastItemAt\s*=\s*0/.test(src));
cek('lastJualAt dideklarasikan', /let lastJualAt\s*=\s*0/.test(src));

console.log('\n=== 2. Frame `items` memperbarui lastItemAt ===');
const blokItems = blok(src, "if (ev === 'jual' || ev === 'jual-ping')", '} catch { /* payload rusak');
cek('lastItemAt diperbarui di jalur items', /lastItemAt = Date\.now\(\)/.test(blokItems), blokItems.slice(0, 200));

console.log('\n=== 3. `jual` memperbarui lastJualAt, `jual-ping` TIDAK ===');
const blokJual = blok(src, "if (ev === 'jual' || ev === 'jual-ping')", "continue;");
cek('lastJualAt hanya saat ev === jual', /if \(ev === 'jual'\) lastJualAt = Date\.now\(\)/.test(blokJual), blokJual);

console.log('\n=== 4. syncStok penuh memperbarui lastItemAt ===');
const blokSync = blok(src, 'lastSync = Date.now();', 'return { ok: true');
cek('lastItemAt diperbarui setelah sync penuh', /lastItemAt = Date\.now\(\)/.test(blokSync));

console.log('\n=== 5. PENJAGA memakai lastItemAt, BUKAN lastSseFrameAt ===');
const blokJaga = blok(src, 'const jaga = setInterval(', 'if (jaga.unref)');
cek('penjaga memakai lastItemAt', /Math\.max\(lastItemAt, lastSync\)/.test(blokJaga), blokJaga.slice(0, 300));
cek('penjaga TIDAK memakai lastSseFrameAt sebagai bukti', !/const bukti\w* = Math\.max\(lastSseFrameAt/.test(blokJaga));
cek('ada pemicu "ada nota tapi tak ada frame items"', /umurSetelahJual/.test(blokJaga));
cek('NOTA_GRACE_MS dideklarasikan', /const NOTA_GRACE_MS/.test(src));

console.log('\n=== 6. status() melaporkan kesegaran ITEM ===');
const blokStatus = blok(src, 'function status()', 'function mulaiAutoSync');
cek('umurItemDetik dihitung dari lastItemAt', /const terakhirItem = Math\.max\(lastItemAt, lastSync\)/.test(blokStatus));
cek('umurItemDetik ada di objek status', /umurItemDetik,/.test(blokStatus));
cek('itemSegar ada di objek status', /itemSegar,/.test(blokStatus));
cek('notaTanpaItemDetik ada di objek status', /notaTanpaItemDetik:/.test(blokStatus));

console.log('\n=== 7. /health meneruskan kesegaran item ===');
cek('umurItemDetik di iposRingkas', /umurItemDetik: s\.umurItemDetik/.test(idx));
cek('itemSegar di iposRingkas', /itemSegar: s\.itemSegar/.test(idx));

console.log('\n=== 8. Tidak ada regresi: jual-ping tetap dianggap bukti KONEKSI ===');
cek('lastSseFrameAt tetap diperbarui semua frame sah', /lastSseFrameAt = Date\.now\(\)/.test(src));
cek('umurKoneksiDetik tetap memakai lastSseFrameAt', /Math\.max\(lastSseAt, lastSync, lastSseFrameAt\)/.test(blokStatus));

console.log(`\n══════════════════════════════════`);
console.log(`LULUS ${lulus}, GAGAL ${gagal}`);
process.exit(gagal === 0 ? 0 : 1);

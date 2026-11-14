'use strict';
/**
 * Tes: deteksi volume tidak persisten — HARUS tidak bisa dipalsukan.
 *
 * TEMUAN REVIEW (Critical C1): versi pertama sirkular. Penanda .volume-ok
 * ditulis oleh docker-entrypoint.sh ke /data, lalu periksaVolume() hanya
 * mencari penanda itu. Kalau volume TIDAK terpasang, /data hanyalah folder
 * biasa di disk container: mkdir berhasil, penanda tercipta, dan pemeriksaan
 * melaporkan ok:true. Persis kondisi yang seharusnya ditangkap.
 *
 * Perbaikan: pakai penanda yang dibuat di IMAGE, bukan oleh entrypoint.
 * Dockerfile membuat /data/.image-only. Bila volume benar-benar ter-mount,
 * mount itu MENUTUPI folder image sehingga penanda TIDAK terlihat. Bila
 * penanda masih terlihat -> volume tidak terpasang.
 *
 * Kontrak: periksaVolume(dir) -> { ok, alasan }
 *   EXPECT_VOLUME != '1'            -> ok (mode lokal)
 *   ada <dir>/.image-only           -> GAGAL (volume tidak terpasang)
 *   RAILWAY_VOLUME_MOUNT_PATH tidak cocok dgn dir -> GAGAL
 *   selain itu                      -> ok
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { periksaVolume, NAMA_PENANDA_IMAGE } = require('./volume-check.js');

let gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) { console.log('  PASS  ' + nama); }
  else { console.error('  GAGAL ' + nama + (detail ? ' -> ' + detail : '')); gagal++; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vol2-'));

// ── 1. Mode lokal: tidak mengharapkan volume, apa pun isinya harus ok
delete process.env.EXPECT_VOLUME;
delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
fs.writeFileSync(path.join(tmp, NAMA_PENANDA_IMAGE), 'x');
cek('mode lokal tetap ok walau penanda image ada', periksaVolume(tmp).ok);

// ── 2. KASUS INTI: volume TIDAK terpasang -> penanda image masih terlihat
process.env.EXPECT_VOLUME = '1';
const a = periksaVolume(tmp);
cek('volume tidak terpasang DITOLAK', a.ok === false, JSON.stringify(a));
cek('alasan menyebut volume tidak terpasang', /tidak terpasang|tidak ter-mount/i.test(a.alasan || ''), a.alasan);

// ── 3. Volume terpasang: penanda image TERTUTUPI -> ok
const terpasang = fs.mkdtempSync(path.join(os.tmpdir(), 'vol2-mount-'));
const b = periksaVolume(terpasang);
cek('volume terpasang diterima', b.ok === true, JSON.stringify(b));

// ── 4. RAILWAY_VOLUME_MOUNT_PATH menunjuk folder lain -> tolak
process.env.RAILWAY_VOLUME_MOUNT_PATH = '/data-lain';
const c = periksaVolume(terpasang);
cek('mount path tidak cocok DITOLAK', c.ok === false, JSON.stringify(c));
cek('alasan menyebut mount path', /RAILWAY_VOLUME_MOUNT_PATH|mount/i.test(c.alasan || ''), c.alasan);

// ── 5. RAILWAY_VOLUME_MOUNT_PATH cocok -> ok
process.env.RAILWAY_VOLUME_MOUNT_PATH = terpasang;
cek('mount path cocok diterima', periksaVolume(terpasang).ok === true);

// ── 6. Folder tidak ada -> tolak, jangan crash
delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
const d = periksaVolume(path.join(tmp, 'tidak-ada'));
cek('folder tidak ada DITOLAK', d.ok === false, JSON.stringify(d));

fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(terpasang, { recursive: true, force: true });
delete process.env.EXPECT_VOLUME;

if (gagal) process.exit(1);
console.log('OK volume-check 6/6 (penanda image, tidak bisa dipalsukan)');

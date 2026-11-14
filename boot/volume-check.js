'use strict';
/**
 * Deteksi volume tidak persisten.
 *
 * Railway: bila volume /data lupa dipasang, bot tetap start dan menulis ke
 * disk container. Semua data hilang saat redeploy TANPA error. Modul ini
 * membuat kondisi itu terlihat.
 *
 * ── Kenapa BUKAN penanda yang ditulis entrypoint ──────────────────────────
 * Versi pertama memakai penanda .volume-ok yang dibuat docker-entrypoint.sh
 * di dalam /data, lalu hanya mencari penanda itu. Itu SIRKULAR: kalau volume
 * tidak terpasang, /data hanyalah folder biasa di disk container, mkdir
 * berhasil, penanda tercipta, dan pemeriksaan melaporkan ok:true — persis
 * kondisi yang seharusnya ditangkap.
 *
 * ── Sinyal yang dipakai sekarang ─────────────────────────────────────────
 * 1. PENANDA IMAGE (utama). Dockerfile menjalankan
 *    `RUN mkdir -p /data && touch /data/.image-only` saat build. Bila volume
 *    benar-benar ter-mount di /data, mount itu MENUTUPI isi folder image,
 *    sehingga .image-only TIDAK terlihat. Kalau penanda masih terlihat,
 *    artinya /data masih folder image -> volume tidak terpasang.
 *    Entrypoint tidak pernah membuat penanda ini, jadi tidak bisa dipalsukan.
 * 2. RAILWAY_VOLUME_MOUNT_PATH (bila Railway menyediakannya). Kalau ada dan
 *    tidak menunjuk folder data kita, berarti volume terpasang di tempat lain.
 *
 * Aturan:
 *  - EXPECT_VOLUME != '1'                    -> ok (mode lokal, PC tidak berubah)
 *  - ada <dir>/.image-only                   -> GAGAL (volume tidak terpasang)
 *  - RAILWAY_VOLUME_MOUNT_PATH != <dir>      -> GAGAL
 *  - selain itu                              -> ok
 */

const fs = require('fs');
const path = require('path');

/** Penanda yang dibuat di IMAGE (bukan runtime). Keberadaannya = volume TIDAK terpasang. */
const NAMA_PENANDA_IMAGE = '.image-only';

/** Penanda lama; sekarang hanya berarti "entrypoint sudah jalan". Bukan uji volume. */
const NAMA_PENANDA = '.volume-ok';

function samakanJalur(a, b) {
  try {
    const ra = fs.realpathSync(a);
    const rb = fs.realpathSync(b);
    return ra === rb;
  } catch (_) {
    return path.resolve(a) === path.resolve(b);
  }
}

function periksaVolume(dir) {
  if (process.env.EXPECT_VOLUME !== '1') {
    return { ok: true, alasan: 'mode lokal (EXPECT_VOLUME tidak diset)' };
  }
  if (!dir) {
    return { ok: false, alasan: 'EXPECT_VOLUME=1 tetapi folder data tidak diketahui' };
  }

  // Folder data harus ada dan bisa diakses.
  try {
    if (!fs.statSync(dir).isDirectory()) {
      return { ok: false, alasan: dir + ' bukan folder' };
    }
  } catch (err) {
    return {
      ok: false,
      alasan: 'folder data ' + dir + ' tidak bisa diakses (' + err.code + '). '
        + 'Volume kemungkinan TIDAK terpasang.',
    };
  }

  // (1) Penanda image masih terlihat -> mount tidak menutupinya -> tidak terpasang.
  const penandaImage = path.join(dir, NAMA_PENANDA_IMAGE);
  try {
    if (fs.existsSync(penandaImage)) {
      return {
        ok: false,
        alasan: 'volume TIDAK terpasang: penanda image ' + NAMA_PENANDA_IMAGE
          + ' masih terlihat di ' + dir
          + '. Semua data akan hilang saat redeploy.',
      };
    }
  } catch (err) {
    return { ok: false, alasan: 'gagal memeriksa ' + penandaImage + ': ' + err.message };
  }

  // (2) Railway memberi tahu lokasi mount; kalau beda, volume ada di tempat lain.
  const mountPath = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  if (mountPath && !samakanJalur(mountPath, dir)) {
    return {
      ok: false,
      alasan: 'RAILWAY_VOLUME_MOUNT_PATH=' + mountPath + ' tidak menunjuk folder data '
        + dir + '. Volume terpasang di lokasi lain; data bot tidak persisten.',
    };
  }

  return {
    ok: true,
    alasan: 'volume terpasang di ' + dir
      + (mountPath ? ' (RAILWAY_VOLUME_MOUNT_PATH=' + mountPath + ')' : ''),
  };
}

module.exports = { periksaVolume, NAMA_PENANDA, NAMA_PENANDA_IMAGE };

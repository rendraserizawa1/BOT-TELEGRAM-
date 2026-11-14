'use strict';
/**
 * Deteksi volume tidak persisten.
 *
 * Railway: bila volume /data lupa dipasang, bot tetap start dan menulis ke
 * disk container. Semua data hilang saat redeploy TANPA error. Modul ini
 * membuat kondisi itu terlihat.
 *
 * Aturan:
 *  - EXPECT_VOLUME != '1'  -> ok (mode lokal; perilaku PC tidak berubah)
 *  - EXPECT_VOLUME == '1' dan ada <dir>/.volume-ok -> ok
 *  - EXPECT_VOLUME == '1' dan penanda tidak ada     -> gagal
 *
 * Penanda .volume-ok dibuat oleh docker-entrypoint.sh, jadi keberadaannya
 * membuktikan entrypoint benar-benar berjalan dan folder itu hidup.
 */

const fs = require('fs');
const path = require('path');

const NAMA_PENANDA = '.volume-ok';

function periksaVolume(dir) {
  if (process.env.EXPECT_VOLUME !== '1') {
    return { ok: true, alasan: 'mode lokal (EXPECT_VOLUME tidak diset)' };
  }
  if (!dir) {
    return { ok: false, alasan: 'EXPECT_VOLUME=1 tetapi folder data tidak diketahui' };
  }
  const penanda = path.join(dir, NAMA_PENANDA);
  try {
    if (fs.existsSync(penanda)) {
      return { ok: true, alasan: 'penanda ' + NAMA_PENANDA + ' ada di ' + dir };
    }
  } catch (err) {
    return { ok: false, alasan: 'gagal memeriksa ' + penanda + ': ' + err.message };
  }
  return {
    ok: false,
    alasan: 'EXPECT_VOLUME=1 tetapi ' + dir + ' tidak punya penanda ' + NAMA_PENANDA
      + '. Volume kemungkinan TIDAK terpasang: semua data akan hilang saat redeploy.',
  };
}

module.exports = { periksaVolume, NAMA_PENANDA };

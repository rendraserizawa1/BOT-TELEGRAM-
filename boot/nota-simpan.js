'use strict';
/**
 * Penyimpanan nota: tujuan utama share SMB, dengan fallback lokal.
 *
 * Kode lama menulis HANYA ke \\100.125.99.99\... dan komentarnya menegaskan
 * "TANPA fallback". Di container Railway path UNC tidak ada, sehingga nota
 * pengguna akan hilang tanpa jejak. Modul ini:
 *   1. mencoba folder share (perilaku lama, tetap utama di PC),
 *   2. bila gagal, menyimpan ke folder fallback lokal,
 *   3. melaporkan alasan kegagalan share agar admin bisa diberi tahu.
 *
 * Dipisah dari index.js supaya bisa diuji tanpa Telegram.
 */

const fs = require('fs');
const path = require('path');

/** Buang komponen path berbahaya: jangan pernah biarkan nama file keluar folder. */
function namaAman(nama) {
  const dasar = path.basename(String(nama || 'nota.jpg'));
  return dasar.replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').slice(0, 200) || 'nota.jpg';
}

/**
 * Tulis buffer ke folder. Membuat folder bila belum ada, lalu MEMBUKTIKAN
 * folder benar-benar bisa ditulis (uji tulis + hapus) sebelum menulis nota.
 * Tidak pernah melempar: selalu mengembalikan {ok, path} atau {ok:false, error}.
 */
function simpanKeFolder(folder, namaFile, buffer) {
  try {
    if (!folder) return { ok: false, error: 'folder tujuan kosong' };
    if (!Buffer.isBuffer(buffer)) return { ok: false, error: 'buffer nota tidak valid' };

    fs.mkdirSync(folder, { recursive: true });
    if (!fs.existsSync(folder)) {
      return { ok: false, error: 'folder tidak terbentuk: ' + folder };
    }

    const uji = path.join(folder, '.tulis-uji');
    fs.writeFileSync(uji, 'ok');
    fs.unlinkSync(uji);

    const tujuan = path.join(folder, namaAman(namaFile));
    fs.writeFileSync(tujuan, buffer);
    return { ok: true, path: tujuan };
  } catch (err) {
    return { ok: false, error: (err && err.message) ? err.message : String(err) };
  }
}

/**
 * Simpan ke share; bila gagal simpan ke folderFallback.
 * Mengembalikan { ok, path, fallback, alasanShare }.
 * `fallback:true` berarti nota SELAMAT tetapi belum ada di share.
 */
function simpanDenganFallback({ folderShare, namaFile, buffer, folderFallback }) {
  const share = simpanKeFolder(folderShare, namaFile, buffer);
  if (share.ok) {
    return { ok: true, path: share.path, fallback: false, alasanShare: null };
  }

  const alasanShare = share.error || 'tidak diketahui';
  const fb = simpanKeFolder(folderFallback, namaFile, buffer);
  if (fb.ok) {
    return { ok: true, path: fb.path, fallback: true, alasanShare };
  }

  return {
    ok: false,
    path: null,
    fallback: true,
    alasanShare,
    error: 'share gagal (' + alasanShare + ') dan fallback gagal (' + (fb.error || 'tidak diketahui') + ')',
  };
}

module.exports = { simpanKeFolder, simpanDenganFallback, namaAman };

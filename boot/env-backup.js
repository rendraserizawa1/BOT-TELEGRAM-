'use strict';
/**
 * Klasifikasi kondisi backup .env.
 *
 * `backupEnvSecaraAman()` di index.js mencari `.env` di folder aplikasi.
 * Di container Railway berkas itu MEMANG tidak ada: kredensial disuntik
 * sebagai environment variable oleh platform. Versi lama mencetak
 *
 *   [ERROR] [SECURE] File .env tidak ditemukan! Kredensial tidak bisa
 *                    dipulihkan otomatis.
 *
 * Pesan itu menakutkan dan menyesatkan — seolah kredensial hilang, padahal
 * aman di platform. Modul ini memisahkan keputusan itu agar bisa diuji dan
 * agar perilaku di PC tidak berubah.
 */

/**
 * @param {{adaFileEnv?: boolean, envPlatform?: boolean}} o
 * @returns {{aksi: 'backup'|'lewati', level?: 'info'|'error', pesan?: string}}
 */
function klasifikasiBackupEnv(o) {
  const opt = (o && typeof o === 'object') ? o : {};
  const adaFileEnv = opt.adaFileEnv === true;
  const envPlatform = opt.envPlatform === true;

  if (adaFileEnv) {
    return { aksi: 'backup' };
  }

  if (envPlatform) {
    return {
      aksi: 'lewati',
      level: 'info',
      pesan: 'Tidak ada berkas .env di container — kredensial disuntik sebagai '
        + 'environment variable oleh platform (Railway). Tidak ada berkas rahasia '
        + 'di disk yang perlu di-backup, jadi langkah ini dilewati.',
    };
  }

  return {
    aksi: 'lewati',
    level: 'error',
    pesan: 'File .env tidak ditemukan! Kredensial tidak bisa dipulihkan otomatis.',
  };
}

/** Apakah kita berjalan di platform yang menyuntik env sendiri (bukan PC)? */
function diPlatformEnv() {
  return !!(process.env.RAILWAY_ENVIRONMENT
    || process.env.RAILWAY_PROJECT_ID
    || process.env.RAILWAY_SERVICE_ID);
}

module.exports = { klasifikasiBackupEnv, diPlatformEnv };

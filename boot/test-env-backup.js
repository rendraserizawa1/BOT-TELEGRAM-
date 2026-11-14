'use strict';
/**
 * Tes: klasifikasi kondisi backup .env.
 *
 * MASALAH YANG DIPERBAIKI
 * `backupEnvSecaraAman()` di index.js mencari `.env` di folder aplikasi. Di
 * container Railway berkas itu MEMANG tidak ada — kredensial disuntik sebagai
 * environment variable oleh platform. Akibatnya setiap startup mencetak:
 *
 *   [ERROR] [SECURE] File .env tidak ditemukan! Kredensial tidak bisa
 *                    dipulihkan otomatis.
 *
 * Pesan itu menakutkan dan menyesatkan: seolah kredensial hilang, padahal
 * aman di platform. Yang benar: di container, ini INFO (tidak ada yang perlu
 * di-backup karena tidak ada berkas rahasia di disk).
 *
 * Perilaku di PC harus TETAP: `.env` ada -> backup seperti biasa. Kalau `.env`
 * benar-benar hilang di PC, itu memang ERROR yang layak diperingatkan.
 *
 * Kontrak: klasifikasiBackupEnv({ adaFileEnv, envPlatform })
 *   adaFileEnv true                      -> { aksi: 'backup' }
 *   adaFileEnv false + envPlatform true  -> { aksi: 'lewati', level: 'info' }
 *   adaFileEnv false + envPlatform false -> { aksi: 'lewati', level: 'error' }
 */

const { klasifikasiBackupEnv } = require('./env-backup.js');

let gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) console.log('  PASS  ' + nama);
  else { console.error('  GAGAL ' + nama + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')); gagal++; }
}

// ── PC: .env ada -> backup, tidak ada peringatan
const a = klasifikasiBackupEnv({ adaFileEnv: true, envPlatform: false });
cek('.env ada -> aksi backup', a.aksi === 'backup', a);
cek('.env ada -> tanpa level error', a.level !== 'error', a);

// ── Railway: tidak ada .env tapi platform menyuntik env -> INFO, bukan ERROR
const b = klasifikasiBackupEnv({ adaFileEnv: false, envPlatform: true });
cek('tanpa .env + platform env -> lewati', b.aksi === 'lewati', b);
cek('tanpa .env + platform env -> level info (BUKAN error)', b.level === 'info', b);
cek('pesan menjelaskan kredensial aman di platform',
  /platform|environment variable|Railway/i.test(b.pesan || ''), b.pesan);
cek('pesan TIDAK menakut-nakuti soal kredensial hilang',
  !/tidak bisa dipulihkan/i.test(b.pesan || ''), b.pesan);

// ── PC tanpa .env -> memang ERROR yang layak
const c = klasifikasiBackupEnv({ adaFileEnv: false, envPlatform: false });
cek('tanpa .env + tanpa platform env -> lewati', c.aksi === 'lewati', c);
cek('tanpa .env + tanpa platform env -> level error', c.level === 'error', c);
cek('pesan menyebut .env tidak ditemukan', /\.env/.test(c.pesan || ''), c.pesan);

// ── Masukan aneh tidak boleh melempar
for (const buruk of [undefined, null, {}, { adaFileEnv: 'ya' }]) {
  let lempar = false;
  try { klasifikasiBackupEnv(buruk); } catch (_) { lempar = true; }
  cek('masukan ' + JSON.stringify(buruk) + ' tidak melempar', !lempar);
}

if (gagal) { console.error('\n' + gagal + ' GAGAL'); process.exit(1); }
console.log('\nOK env-backup: ERROR palsu di Railway hilang, perilaku PC tetap');

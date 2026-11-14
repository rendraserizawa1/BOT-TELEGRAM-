'use strict';
/**
 * Tes: path data bot harus bisa diarahkan lewat environment variable,
 * dengan FALLBACK ke nilai lama (__dirname) bila env tidak diisi.
 *
 * Kenapa: di Railway semua data harus di volume /data. Tanpa ini, setiap
 * redeploy menghapus riwayat chat, sesi, file, log, dan backup.
 *
 * Kontrak: bot-db.js mengekspor paths() -> {db, files, backups, secure, root}.
 */

const path = require('path');

process.env.DATA_DIR = path.join(path.sep, 'data');

// Muat ulang modul agar env terbaca
delete require.cache[require.resolve('../bot-db.js')];
const db = require('../bot-db.js');

if (typeof db.paths !== 'function') {
  console.error('GAGAL: bot-db.js tidak mengekspor paths()');
  process.exit(1);
}

const p = db.paths();
const harap = [
  ['db', path.join(path.sep, 'data', 'bot.db')],
  ['files', path.join(path.sep, 'data', 'files')],
  ['backups', path.join(path.sep, 'data', 'backups')],
  ['secure', path.join(path.sep, 'data', 'secure')],
  ['root', path.join(path.sep, 'data')],
];

let gagal = 0;
for (const [kunci, nilai] of harap) {
  const dapat = p[kunci];
  if (path.resolve(String(dapat)) !== path.resolve(nilai)) {
    console.error(`GAGAL ${kunci}: dapat "${dapat}" harap "${nilai}"`);
    gagal++;
  }
}

// Konstanta lama harus ikut berubah, bukan hanya paths()
if (path.resolve(db.DB_PATH) !== path.resolve(path.join(path.sep, 'data', 'bot.db'))) {
  console.error(`GAGAL DB_PATH: dapat "${db.DB_PATH}"`);
  gagal++;
}
if (path.resolve(db.DATA_DIR) !== path.resolve(path.join(path.sep, 'data'))) {
  console.error(`GAGAL DATA_DIR: dapat "${db.DATA_DIR}"`);
  gagal++;
}

// Fallback: tanpa DATA_DIR harus kembali ke <root>/data
delete process.env.DATA_DIR;
delete require.cache[require.resolve('../bot-db.js')];
const db2 = require('../bot-db.js');
const harapFallback = path.join(path.join(__dirname, '..'), 'data');
if (path.resolve(db2.DATA_DIR) !== path.resolve(harapFallback)) {
  console.error(`GAGAL fallback: dapat "${db2.DATA_DIR}" harap "${harapFallback}"`);
  gagal++;
}

if (gagal) process.exit(1);
console.log('OK path dari env + fallback (' + harap.length + ' kunci + 3 cek konstanta)');

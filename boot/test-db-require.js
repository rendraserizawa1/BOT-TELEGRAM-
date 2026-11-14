'use strict';
/**
 * Tes: bot-db.js HARUS gagal keras bila `node:sqlite` tidak tersedia.
 *
 * Kenapa ini penting:
 * Di Node 20 (image Docker lama) `require('node:sqlite')` melempar, lalu
 * bot-db.js lama hanya `console.error` dan `return null`. Akibatnya SELURUH
 * fungsi DB jadi no-op SENYAP: riwayat chat, sesi, file, log, backup DB
 * hilang tanpa satu pun error yang terlihat. Bug ini tidak pernah muncul di
 * PC ini karena lokal memakai Node 24.
 *
 * Cara mensimulasikan Node 20: pasang hook Module._load di proses anak yang
 * menolak `node:sqlite`, lalu require bot-db.js. Bila tetap exit 0 berarti
 * bug senyap masih ada.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const hook = `
const M = require('module');
const asli = M._load;
M._load = function (req, ...rest) {
  if (req === 'node:sqlite') {
    const e = new Error("Cannot find module 'node:sqlite'");
    e.code = 'MODULE_NOT_FOUND';
    throw e;
  }
  return asli.call(this, req, ...rest);
};
require('./bot-db.js');
`;

const hasil = spawnSync(process.execPath, ['-e', hook], {
  cwd: ROOT,
  encoding: 'utf8',
  timeout: 60000,
});

const gabung = String(hasil.stderr || '') + String(hasil.stdout || '');

if (hasil.status === 0) {
  console.error('GAGAL: bot-db.js tetap exit 0 saat node:sqlite tidak ada.');
  console.error('        Artinya DB masih mati senyap (riwayat/sesi/file hilang tanpa error).');
  process.exit(1);
}

if (!/node:sqlite/.test(gabung)) {
  console.error('GAGAL: proses gagal tetapi pesannya tidak menyebut node:sqlite.');
  console.error('        Keluaran: ' + gabung.slice(0, 400));
  process.exit(1);
}

console.log('OK fail-fast node:sqlite (exit=' + hasil.status + ')');

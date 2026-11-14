'use strict';
/**
 * Tes: bot-db.js HARUS gagal keras bila `node:sqlite` tidak tersedia,
 * DAN tetap bisa dijalankan bila sengaja diizinkan (DB_ALLOW_DEGRADED=1).
 *
 * Kenapa ini penting:
 * Di Node 20 (image Docker lama) `require('node:sqlite')` melempar, lalu
 * bot-db.js lama hanya `console.error` dan `return null`. Akibatnya SELURUH
 * fungsi DB jadi no-op SENYAP: riwayat chat, sesi, file, log, backup DB
 * hilang tanpa satu pun error yang terlihat. Bug ini tidak pernah muncul di
 * PC ini karena lokal memakai Node 24.
 *
 * Cara mensimulasikan Node 20: pasang hook Module._load di proses anak yang
 * menolak `node:sqlite`, lalu require bot-db.js.
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
const db = require('./bot-db.js');
if (process.env.DB_ALLOW_DEGRADED === '1') {
  // Mode degradasi: harus TETAP hidup dan melaporkan tersedia()=false.
  console.log('DEGRADED tersedia=' + db.tersedia());
  process.exit(0);
}
`;

function jalankan(env) {
  return spawnSync(process.execPath, ['-e', hook], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60000,
    env: Object.assign({}, process.env, env),
  });
}

let gagal = 0;

// ── Kasus 1: tanpa izin -> HARUS exit != 0 dan menyebut node:sqlite
const a = jalankan({ DB_ALLOW_DEGRADED: '' });
const teksA = String(a.stderr || '') + String(a.stdout || '');
if (a.status === 0) {
  console.error('GAGAL 1: bot-db.js tetap exit 0 saat node:sqlite tidak ada.');
  console.error('          Artinya DB masih mati senyap (riwayat/sesi/file hilang tanpa error).');
  gagal++;
} else if (!/node:sqlite/.test(teksA)) {
  console.error('GAGAL 1b: proses gagal tetapi pesannya tidak menyebut node:sqlite.');
  console.error('          Keluaran: ' + teksA.slice(0, 400));
  gagal++;
}

// ── Kasus 2: DB_ALLOW_DEGRADED=1 -> boleh lanjut, tersedia()=false
const b = jalankan({ DB_ALLOW_DEGRADED: '1' });
const teksB = String(b.stderr || '') + String(b.stdout || '');
if (b.status !== 0) {
  console.error('GAGAL 2: DB_ALLOW_DEGRADED=1 harus boleh jalan, dapat exit ' + b.status);
  console.error('          Keluaran: ' + teksB.slice(0, 300));
  gagal++;
} else if (!/DEGRADED tersedia=false/.test(teksB)) {
  console.error('GAGAL 2b: mode degradasi harus melaporkan tersedia=false, dapat: ' + teksB.slice(0, 300));
  gagal++;
}

if (gagal) process.exit(1);
console.log('OK fail-fast node:sqlite (exit=' + a.status + ') + escape hatch DB_ALLOW_DEGRADED');

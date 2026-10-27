'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = __dirname;
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');
const checkOnly = process.argv.includes('--check');

function valuesFromEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    return match ? [match[1], match[2].replace(/^['"]|['"]$/g, '')] : null;
  }).filter(Boolean));
}

function checkConfig() {
  if (!fs.existsSync(envPath)) {
    if (fs.existsSync(examplePath)) fs.copyFileSync(examplePath, envPath, fs.constants.COPYFILE_EXCL);
    console.error('Belum ada .env. Template dibuat; isi BOT_TOKEN dan ADMIN_ID, lalu jalankan npm run setup.');
    return false;
  }
  const env = valuesFromEnv(fs.readFileSync(envPath, 'utf8'));
  const missing = ['BOT_TOKEN', 'ADMIN_ID'].filter((key) => !env[key]);
  if (missing.length) {
    console.error(`Konfigurasi wajib belum diisi: ${missing.join(', ')}. Periksa .env; nilainya tidak ditampilkan.`);
    return false;
  }
  console.log('Konfigurasi dasar ditemukan. Nilai rahasia tidak ditampilkan.');
  return true;
}

if (!checkConfig()) process.exit(1);
if (checkOnly) process.exit(0);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const install = spawnSync(npm, ['install', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit' });
if (install.error) throw install.error;
if (install.status !== 0) process.exit(install.status || 1);

const run = spawnSync(process.execPath, [path.join(root, 'index.js')], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
if (run.error) throw run.error;
process.exit(run.status || 0);

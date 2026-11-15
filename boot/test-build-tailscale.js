'use strict';
/** Verifikasi Dockerfile + entrypoint tanpa Docker. */
const fs = require('fs');

let gagal = 0;
const cek = (nama, lulus, detail) => {
  console.log('  ' + (lulus ? 'OK    ' : 'GAGAL ') + nama + (detail ? '  (' + detail + ')' : ''));
  if (!lulus) gagal++;
};

const df = fs.readFileSync('Dockerfile', 'utf8');
const ep = fs.readFileSync('docker-entrypoint.sh', 'utf8');

console.log('=== Dockerfile ===');
cek('versi tailscale dipatok 1.102.4', /ARG\s+TAILSCALE_VER=1\.102\.4/.test(df));
cek('unduhan memakai node (bukan curl/wget)', /node -e/.test(df) && !/^\s*RUN\s+(curl|wget)/m.test(df));
cek('unduhan tidak fatal (ada catch + PERINGATAN)', /PERINGATAN: tailscale gagal diunduh/.test(df));
cek('diletakkan setelah COPY . .', df.indexOf('COPY . .') < df.indexOf('TAILSCALE_VER'));
cek('tidak mendeklarasikan VOLUME (Railway menolak)', !/^VOLUME/m.test(df));
cek('Node 24 dipertahankan', /FROM node:24-slim/.test(df));

console.log('\n=== entrypoint ===');
cek('tanpa set -e', !/^\s*set -e/m.test(ep));
cek('TS_AUTHKEY kosong -> dilewati', /TS_AUTHKEY:-\}/.test(ep) && /dilewati \(TS_AUTHKEY kosong\)/.test(ep));
cek('userspace-networking dipakai', /--tun=userspace-networking/.test(ep));
cek('proxy keluar dibuka di 1056', /--outbound-http-proxy-listen="?\$TS_PROXY"?/.test(ep) && /127\.0\.0\.1:1056/.test(ep));
cek('hostname bcode-railway', /--hostname=bcode-railway/.test(ep));
cek('kunci TIDAK pernah di-echo', !/echo[^\n]*\$\{?TS_AUTHKEY/.test(ep) && !/echo[^\n]*\$TS_AUTHKEY/.test(ep));
cek('kegagalan hanya peringatan (tidak exit)', !/tailscale[^\n]*\n\s*exit 1/.test(ep));
cek('tetap exec "$@" di akhir', /exec "\$@"/.test(ep));

console.log('\n=== package.json ===');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
cek('undici ^7 ada di dependencies', /^\^7\./.test(pkg.dependencies.undici || ''));
cek('engines.node 24.x', String(pkg.engines.node || '').includes('24'));

console.log('\n' + (gagal ? '  ADA ' + gagal + ' YANG GAGAL' : '  SEMUA LULUS'));
process.exit(gagal ? 1 : 0);

'use strict';
/**
 * Jalankan ulang 3 tunnel Cloudflare untuk iPos CP/NK/KEFA, lalu perbarui
 * variabel Railway dan redeploy.
 *
 * KENAPA SKRIP INI ADA
 * Railway tidak punya jalur ke Tailscale CGNAT (100.125.99.99, 100.110.152.33)
 * maupun ke 127.0.0.1 PC ini. Selama solusi permanen (Opsi D: proxy KEFA
 * dipindah ke server toko 192.168.1.199) belum dikerjakan, data iPos di
 * Railway dijembatani lewat tunnel dari PC ini.
 *
 * BATASAN YANG TIDAK BISA DISEMBUNYIKAN
 * - trycloudflare quick tunnel TIDAK punya jaminan uptime.
 * - URL berubah setiap kali cloudflared dijalankan -> skrip ini harus
 *   memperbarui variabel Railway dan redeploy setiap kali.
 * - Tunnel hanya hidup selama PC ini hidup. Ini BUKAN solusi 24/7.
 *
 * Pemakaian:  node boot\tunnel-ipos.js
 */

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const CF = path.join(__dirname, 'cloudflared.exe');
const CLI = 'C:/Users/rdpadmin/AppData/Roaming/npm/node_modules/@railway/cli/bin/railway.js';
const DOMAIN = 'https://kefa-bot-production.up.railway.app';

// Sasaran tunnel. `nama` dipakai untuk nama variabel Railway.
const SASARAN = [
  { nama: 'IPOS_URL', toko: 'CP', url: 'http://100.125.99.99:8080' },
  { nama: 'IPOS_NK_URL', toko: 'NK', url: 'http://100.110.152.33:8080' },
  { nama: 'IPOS_KEFA_URL', toko: 'KEFA', url: 'http://127.0.0.1:8080' },
];

function tidur(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** Jalankan satu tunnel, kembalikan URL publiknya. */
async function buatTunnel(sasaran) {
  const outFile = path.join(os.tmpdir(), 'cf-' + sasaran.toko + '-' + Date.now() + '.log');
  const fd = fs.openSync(outFile, 'w');
  const anak = spawn(CF, ['tunnel', '--url', sasaran.url, '--no-autoupdate'], {
    stdio: ['ignore', fd, fd],
    detached: false,
  });

  for (let i = 0; i < 40; i++) {
    await tidur(2000);
    let teks = '';
    try { teks = fs.readFileSync(outFile, 'utf8'); } catch (_) { /* belum ada */ }
    const m = teks.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) return { url: m[0], proses: anak, log: outFile };
  }
  try { anak.kill(); } catch (_) { /* sudah mati */ }
  throw new Error('tunnel ' + sasaran.toko + ' tidak memberi URL dalam 80 dtk (lihat ' + outFile + ')');
}

/** Uji tunnel dengan API key yang sesuai. */
async function ujiTunnel(baseUrl, apiKey) {
  const res = await fetch(baseUrl + '/ipos/health', {
    headers: { 'x-api-key': apiKey },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  return j;
}

function bacaEnv() {
  const env = {};
  const p = path.join(ROOT, '.env');
  for (const b of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = b.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}

(async () => {
  if (!fs.existsSync(CF)) {
    console.error('cloudflared.exe tidak ada di ' + CF);
    console.error('Unduh: https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe');
    process.exit(1);
  }
  const env = bacaEnv();
  const kunci = {
    CP: env.IPOS_KEY,
    NK: env.IPOS_NK_KEY,
    KEFA: env.IPOS_KEFA_KEY,
  };

  console.log('=== Membuat tunnel ===');
  const hasil = [];
  for (const s of SASARAN) {
    try {
      const t = await buatTunnel(s);
      const sehat = await ujiTunnel(t.url, kunci[s.toko]);
      console.log('  ' + s.toko.padEnd(5) + ' ' + t.url + '  items=' + sehat.items);
      hasil.push({ sasaran: s, url: t.url, proses: t.proses });
    } catch (e) {
      console.error('  ' + s.toko.padEnd(5) + ' GAGAL: ' + e.message);
    }
  }

  if (!hasil.length) {
    console.error('\nTidak ada tunnel yang berhasil. Tidak ada yang diubah di Railway.');
    process.exit(1);
  }

  console.log('\n=== Perbarui variabel Railway (nilai URL, bukan rahasia) ===');
  for (const h of hasil) {
    const nilai = h.url + '/ipos';
    try {
      execFileSync(process.execPath, [CLI, 'variables', '--set', h.sasaran.nama + '=' + nilai], {
        cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000,
      });
      console.log('  ok   ' + h.sasaran.nama + ' = ' + nilai);
    } catch (e) {
      console.error('  GAGAL ' + h.sasaran.nama + ': ' + String(e.stderr || e.message).split('\n')[0]);
    }
  }

  console.log('\n=== Redeploy ===');
  try {
    execFileSync(process.execPath, [CLI, 'up', '--ci'], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 1800000,
    });
    console.log('  deploy selesai');
  } catch (e) {
    console.error('  deploy gagal: ' + String(e.stderr || e.message).split('\n')[0]);
  }

  console.log('\n=== Verifikasi (tunggu 90 dtk) ===');
  await tidur(90000);
  try {
    const res = await fetch(DOMAIN + '/health', { signal: AbortSignal.timeout(40000) });
    const h = await res.json();
    for (const tk of ['cp', 'nk', 'kefa']) {
      const s = h.ipos[tk];
      console.log('  ' + tk.padEnd(5) + ' online=' + s.online + ' segar=' + s.itemSegar + ' umur=' + s.umurItemDetik + 's');
    }
  } catch (e) {
    console.error('  tidak bisa membaca /health: ' + e.message);
  }

  console.log('\nPENTING: tunnel ini mati kalau PC dimatikan.');
  console.log('Solusi permanen = Opsi D (proxy KEFA pindah ke 192.168.1.199).');
  console.log('Biarkan jendela ini terbuka; Ctrl+C mematikan tunnel.');
  // Tahan proses agar tunnel tetap hidup.
  await new Promise(() => {});
})().catch((e) => {
  console.error('FATAL: ' + e.message);
  process.exit(1);
});

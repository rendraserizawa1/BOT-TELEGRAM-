'use strict';
/**
 * VERIFIKASI NYATA: pakai data CP yang sebenarnya, tampilkan teks peringatan
 * persis seperti yang akan dibaca pengguna di Telegram.
 *
 * Bukan simulasi angka karangan: `update` diambil dari respons asli
 * /api/jual proxy CP, lalu diumpankan ke fungsi headerLaporanBasi yang
 * diambil dari index.js. Jadi yang dicetak di sini adalah kalimat sungguhan.
 */
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const ROOT = path.join(__dirname, '..');
for (const berkas of [path.join(__dirname, 'push-agen.env'), path.join(ROOT, '.env')]) {
  let isi; try { isi = fs.readFileSync(berkas, 'utf8'); } catch (_) { continue; }
  for (const baris of isi.split(/\r?\n/)) {
    const m = baris.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

function minta(url, timeout) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method: 'GET',
    }, (res) => {
      const p = [];
      res.on('data', (d) => p.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(p).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(timeout || 90000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

// Ambil fungsi asli dari index.js (index.js tidak bisa di-require).
const SUMBER = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
function ekstrak(nama) {
  const mulai = SUMBER.indexOf('function ' + nama + '(');
  if (mulai < 0) throw new Error('fungsi ' + nama + ' tidak ada di index.js');
  let i = SUMBER.indexOf('{', mulai);
  let dalam = 0;
  for (; i < SUMBER.length; i++) {
    if (SUMBER[i] === '{') dalam++;
    else if (SUMBER[i] === '}') { dalam--; if (dalam === 0) { i++; break; } }
  }
  return SUMBER.slice(mulai, i);
}
const escapeMd = (s) => String(s == null ? '' : s).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
const GARIS_TEBAL = '━━━━━━━━━━━━━━━━━━━━';
// eslint-disable-next-line no-new-func
const headerLaporanBasi = new Function('escapeMd', 'GARIS_TEBAL',
  ekstrak('headerLaporanBasi') + '\nreturn headerLaporanBasi;')(escapeMd, GARIS_TEBAL);

const TOKO = [
  { id: 'CP', url: process.env.IPOS_URL, key: process.env.IPOS_KEY },
  { id: 'NK', url: process.env.IPOS_NK_URL, key: process.env.IPOS_NK_KEY },
  { id: 'KEFA', url: process.env.IPOS_KEFA_URL, key: process.env.IPOS_KEFA_KEY },
].filter((t) => t.url && t.key);

function tglLokal() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

(async () => {
  const hari = tglLokal();
  console.log('=== teks peringatan yang dilihat pengguna (data asli) ===');
  console.log('  tanggal ' + hari);
  console.log('');
  for (const t of TOKO) {
    const q = '/api/jual?dari=' + hari + '&sampai=' + hari + '&key=' + encodeURIComponent(t.key);
    let d;
    try { d = JSON.parse((await minta(t.url + q)).body); }
    catch (e) { console.log('  ' + t.id + ': GAGAL ambil -> ' + e.message); continue; }

    const upd = Number(d.update);
    const updMs = Number.isFinite(upd) && upd > 0 ? (upd > 1e12 ? upd : upd * 1000) : NaN;
    const umurDetik = (Date.now() - updMs) / 1000;
    const h = headerLaporanBasi(umurDetik, d.updateSebab || d.err || null);

    console.log('--- ' + t.id + ' ---');
    console.log('  update=' + d.update + '  umur=' + Math.round(umurDetik) + ' dtk  nota=' + (d.total && d.total.nota));
    if (h) {
      console.log('  PENGguna AKAN MELIHAT:');
      for (const baris of h.split('\n')) if (baris.trim()) console.log('     ' + baris);
    } else {
      console.log('  pengguna TIDAK melihat peringatan (data masih segar) — benar');
    }
    console.log('');
  }
})().catch((e) => { console.log('FATAL: ' + ((e && e.stack) || e)); process.exit(1); });

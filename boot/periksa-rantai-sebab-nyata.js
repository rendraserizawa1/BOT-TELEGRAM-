'use strict';
/**
 * VERIFIKASI RANTAI NYATA: fungsi tempelSebabBilaBeku yang ASLI, dijalankan
 * terhadap proxy CP yang ASLI, dengan laporan CP yang ASLI.
 *
 * Ini bukan tiruan: `ambilJson` di sini benar-benar memanggil HTTP ke proxy
 * toko, dan laporannya diambil dari /api/jual yang sesungguhnya. Jadi bila
 * sebab tercetak di bawah, sebab itu memang akan ikut terkirim ke bot.
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

function ambilJson(url, timeout) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method: 'GET',
    }, (res) => {
      const p = [];
      res.on('data', (d) => p.push(d));
      res.on('end', () => {
        const t = Buffer.concat(p).toString('utf8');
        try { resolve(JSON.parse(t)); } catch (e) { reject(new Error('bukan JSON: ' + t.slice(0, 80))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout || 90000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

// Ambil fungsi ASLI dari push-agen.js.
const SUMBER = fs.readFileSync(path.join(__dirname, 'push-agen.js'), 'utf8');
const mulai = SUMBER.indexOf('async function tempelSebabBilaBeku(');
if (mulai < 0) { console.log('FATAL: fungsi tidak ditemukan'); process.exit(1); }
let i = SUMBER.indexOf('{', mulai), dalam = 0;
for (; i < SUMBER.length; i++) {
  if (SUMBER[i] === '{') dalam++;
  else if (SUMBER[i] === '}') { dalam--; if (dalam === 0) { i++; break; } }
}
// eslint-disable-next-line no-new-func
const tempelSebabBilaBeku = new Function('ambilJson',
  SUMBER.slice(mulai, i) + '\nreturn tempelSebabBilaBeku;')(ambilJson);

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
  console.log('=== rantai nyata: laporan -> tempelSebabBilaBeku -> yang akan dikirim ===');
  console.log('  tanggal ' + hari);
  console.log('');
  for (const t of TOKO) {
    const url = t.url + '/api/jual?dari=' + hari + '&sampai=' + hari + '&key=' + encodeURIComponent(t.key);
    let lap;
    try { lap = await ambilJson(url, 90000); }
    catch (e) { console.log('  ' + t.id + ': GAGAL ambil laporan -> ' + e.message); continue; }

    const sebelum = lap.updateSebab;
    const hasil = await tempelSebabBilaBeku({ url: t.url, key: t.key }, lap);
    const umur = Math.round((Date.now() - (Number(hasil.update) > 1e12 ? Number(hasil.update) : Number(hasil.update) * 1000)) / 1000);

    console.log('--- ' + t.id + ' ---');
    console.log('  update umur = ' + umur + ' dtk');
    if (hasil.updateSebab) {
      console.log('  AKAN DIKIRIM DENGAN SEBAB:');
      console.log('     updateSebab = "' + hasil.updateSebab + '"');
    } else if (sebelum) {
      console.log('  sebab sudah ada dari proxy: "' + sebelum + '"');
    } else {
      console.log('  tidak ada sebab (data segar -> memang tidak perlu) — benar');
    }
    console.log('');
  }
})().catch((e) => { console.log('FATAL: ' + ((e && e.stack) || e)); process.exit(1); });

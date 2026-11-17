'use strict';
/**
 * PERIKSA: apakah laporan penjualan KASIR benar-benar beku di tiap toko?
 *
 * Yang diukur, dipisah dengan sengaja karena sering tertukar:
 *   1. KESEGARAN KIRIMAN  = kapan terakhir agen mengirim (dilihat dari /health
 *      `push.<toko>.jual.umurDetik`). Ini hanya bilang "PC masih mengirim".
 *   2. KESEGARAN DATA     = `update` di dalam laporan, yaitu kapan SUMBER
 *      terakhir memperbarui angka penjualan. Ini yang menentukan apakah angka
 *      yang dilihat pengguna masih benar.
 * Kiriman bisa segar sementara datanya beku — persis kasus CP: agen mengirim
 * ulang laporan yang sama tiap menit, dan /health tampak "segar" kalau hanya
 * melihat nomor 1.
 *
 * Juga memeriksa `kasir_only=1`, karena laporan KASIR memakai parameter itu.
 */
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const BOOT = __dirname;
const ROOT = path.join(__dirname, '..');
for (const berkas of [path.join(BOOT, 'push-agen.env'), path.join(ROOT, '.env')]) {
  let isi; try { isi = fs.readFileSync(berkas, 'utf8'); } catch (_) { continue; }
  for (const baris of isi.split(/\r?\n/)) {
    const m = baris.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const TOKO = [
  { id: 'CP', url: process.env.IPOS_URL, key: process.env.IPOS_KEY },
  { id: 'NK', url: process.env.IPOS_NK_URL, key: process.env.IPOS_NK_KEY },
  { id: 'KEFA', url: process.env.IPOS_KEFA_URL, key: process.env.IPOS_KEFA_KEY },
].filter((t) => t.url && t.key);

const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));

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

function tglLokal() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const umur = (ms) => Math.round((Date.now() - Number(ms)) / 1000);

(async () => {
  const hari = tglLokal();
  console.log('=== laporan penjualan KASIR: sumber vs yang dipakai bot ===');
  console.log('  tanggal ' + hari);
  console.log('');

  // ── Railway ──────────────────────────────────────────────────────────
  console.log('--- Railway (/health) ---');
  let rh = null;
  try {
    const r = await minta('https://kefa-bot-production.up.railway.app/health', 60000);
    rh = JSON.parse(r.body);
  } catch (e) { console.log('  gagal: ' + e.message); }
  if (rh) {
    for (const k of ['cp', 'nk', 'kefa']) {
      const s = rh.ipos[k];
      const p = rh.push[k];
      console.log('  ' + k.toUpperCase().padEnd(5)
        + ' kirimanTerakhir=' + (p && p.jual ? p.jual.umurDetik + ' dtk' : '?')
        + '  dataUmur=' + s.laporanUmurDetik + ' dtk'
        + '  basi=' + s.laporanBasi
        + '  update=' + s.laporanUpdate
        + '  err=' + (s.laporanErr || '-'));
    }
  }

  // ── Sumber ───────────────────────────────────────────────────────────
  console.log('');
  console.log('--- SUMBER: /api/jual (tanpa kasir_only) ---');
  const hasil = {};
  for (const t of TOKO) {
    const q = '/api/jual?dari=' + hari + '&sampai=' + hari + '&key=' + encodeURIComponent(t.key);
    try {
      const a = JSON.parse((await minta(t.url + q)).body);
      await tunggu(7000);
      const b = JSON.parse((await minta(t.url + q)).body);
      const u1 = Number(a.update), u2 = Number(b.update);
      const n1 = a.total ? a.total.nota : null;
      const n2 = b.total ? b.total.nota : null;
      hasil[t.id] = { u1, u2, n1, n2 };
      console.log('  ' + t.id.padEnd(5)
        + ' nota=' + n1 + '->' + n2
        + '  update=' + (u1 === u2 ? 'BEKU' : 'bergerak +' + (u2 - u1) + 'ms')
        + '  umurData=' + umur(u2) + ' dtk');
    } catch (e) {
      console.log('  ' + t.id.padEnd(5) + ' GAGAL: ' + e.message);
    }
  }

  // ── Sumber: kasir_only=1 (dipakai laporan KASIR untuk CP) ────────────
  console.log('');
  console.log('--- SUMBER: /api/jual?kasir_only=1 (inilah laporan KASIR) ---');
  for (const t of TOKO) {
    const q = '/api/jual?dari=' + hari + '&sampai=' + hari + '&kasir_only=1&key=' + encodeURIComponent(t.key);
    try {
      const a = JSON.parse((await minta(t.url + q)).body);
      await tunggu(4000);
      const b = JSON.parse((await minta(t.url + q)).body);
      const u1 = Number(a.update), u2 = Number(b.update);
      const n1 = a.total ? a.total.nota : null;
      const n2 = b.total ? b.total.nota : null;
      console.log('  ' + t.id.padEnd(5)
        + ' nota=' + n1 + '->' + n2
        + '  update=' + (u1 === u2 ? 'BEKU' : 'bergerak +' + (u2 - u1) + 'ms')
        + '  umurData=' + umur(u2) + ' dtk'
        + '  kasir=' + (Array.isArray(a.kasir) ? a.kasir.length : '?'));
    } catch (e) {
      console.log('  ' + t.id.padEnd(5) + ' GAGAL: ' + e.message);
    }
  }

  // ── Sebab kebekuan: /health proxy ────────────────────────────────────
  console.log('');
  console.log('--- /health proxy: sebabnya ---');
  for (const t of TOKO) {
    try {
      const h = JSON.parse((await minta(t.url + '/health?key=' + encodeURIComponent(t.key), 25000)).body);
      const j = h.jual || {};
      const sumber = Array.isArray(j.sumber) ? j.sumber : [];
      console.log('  ' + t.id.padEnd(5) + ' jual.siap=' + j.siap + ' nota=' + j.nota
        + ' err=' + (j.err || '-'));
      for (const s of sumber) {
        console.log('         sumber ' + (s.id || '?') + ': nota=' + s.nota
          + ' refreshUmur=' + (s.refresh ? umur(s.refresh) + ' dtk' : '?')
          + ' err=' + (s.err || '-'));
      }
    } catch (e) {
      console.log('  ' + t.id.padEnd(5) + ' /health gagal: ' + e.message);
    }
  }
})().catch((e) => { console.log('FATAL: ' + ((e && e.stack) || e)); process.exit(1); });

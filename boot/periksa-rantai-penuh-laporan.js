'use strict';
/**
 * VERIFIKASI RANTAI PENUH (tanpa Telegram): laporan CP ASLI -> gudang dorong ->
 * bridge -> teks peringatan yang akan dibaca pengguna.
 *
 * Ini menutup celah terakhir: uji satuan membuktikan potongan-potongannya
 * benar, tetapi belum membuktikan bahwa potongan itu TERSAMBUNG. Di sini
 * laporan diambil dari proxy CP yang sesungguhnya, ditempeli sebab oleh fungsi
 * asli, dimasukkan ke gudang dorong yang asli, dibaca lewat bridge yang asli,
 * lalu diubah menjadi teks oleh fungsi asli dari index.js.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
for (const berkas of [path.join(__dirname, 'push-agen.env'), path.join(ROOT, '.env')]) {
  let isi; try { isi = fs.readFileSync(berkas, 'utf8'); } catch (_) { continue; }
  for (const baris of isi.split(/\r?\n/)) {
    const m = baris.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
if (!process.env.PUSH_TOKEN) process.env.PUSH_TOKEN = 'token-uji-lokal';
// Bridge membaca mode dorong dari env ini.
process.env.PUSH_AKTIF = '1';
process.env.IPOS_URL = process.env.IPOS_URL || '';
process.env.IPOS_KEY = process.env.IPOS_KEY || '';

function ambilJson(url, timeout) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? require('https') : http;
    const req = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method: 'GET',
    }, (res) => {
      const p = [];
      res.on('data', (d) => p.push(d));
      res.on('end', () => {
        const t = Buffer.concat(p).toString('utf8');
        try { resolve(JSON.parse(t)); } catch (e) { reject(new Error('bukan JSON')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout || 90000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

function potongFungsi(sumber, nama, awalan) {
  const mulai = sumber.indexOf((awalan || 'function ') + nama + '(');
  if (mulai < 0) throw new Error('fungsi ' + nama + ' tidak ada');
  let i = sumber.indexOf('{', mulai), dalam = 0;
  for (; i < sumber.length; i++) {
    if (sumber[i] === '{') dalam++;
    else if (sumber[i] === '}') { dalam--; if (dalam === 0) { i++; break; } }
  }
  return sumber.slice(mulai, i);
}

const SUMBER_AGEN = fs.readFileSync(path.join(__dirname, 'push-agen.js'), 'utf8');
const SUMBER_INDEX = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');

// eslint-disable-next-line no-new-func
const tempelSebabBilaBeku = new Function('ambilJson',
  potongFungsi(SUMBER_AGEN, 'tempelSebabBilaBeku', 'async function ') + '\nreturn tempelSebabBilaBeku;')(ambilJson);

const escapeMd = (s) => String(s == null ? '' : s).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
const GARIS_TEBAL = '━━━━━━━━━━━━━━━━━━━━';
// eslint-disable-next-line no-new-func
const headerLaporanBasi = new Function('escapeMd', 'GARIS_TEBAL',
  potongFungsi(SUMBER_INDEX, 'headerLaporanBasi') + '\nreturn headerLaporanBasi;')(escapeMd, GARIS_TEBAL);

const gudang = require('./push-gudang');
const bridge = require('../ipos-bridge');

function tglLokal() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

(async () => {
  const hari = tglLokal();
  console.log('=== RANTAI PENUH: proxy CP asli -> gudang -> bridge -> teks pengguna ===');
  console.log('');

  // 1. Ambil laporan ASLI dari proxy CP.
  const url = process.env.IPOS_URL + '/api/jual?dari=' + hari + '&sampai=' + hari + '&key=' + encodeURIComponent(process.env.IPOS_KEY);
  const lap = await ambilJson(url, 90000);
  console.log('1. laporan CP asli: nota=' + (lap.total && lap.total.nota) + ' omzet=' + (lap.total && lap.total.omzet) + ' update=' + lap.update);

  // 2. Tempelkan sebab (fungsi asli dari push-agen.js).
  await tempelSebabBilaBeku({ url: process.env.IPOS_URL, key: process.env.IPOS_KEY }, lap);
  console.log('2. sebab ditempelkan: ' + (lap.updateSebab || '(tidak ada — data segar)'));

  // 3. Masukkan ke gudang dorong (penerima asli).
  const terima = gudang.terima({ toko: 'cp', jenis: 'jual', data: lap }, process.env.PUSH_TOKEN);
  console.log('3. gudang menerima: HTTP ' + terima.status);

  // 4. Baca lewat bridge asli (jalur yang dipakai bot).
  const b = bridge.buatBridge({
    url: process.env.IPOS_URL, key: process.env.IPOS_KEY, toko: ['cp'], label: 'CP',
  });
  const r = await b.ambilLaporanKasir(hari, hari, { fresh: true });
  console.log('4. bridge mengembalikan: nota=' + (r.total && r.total.nota) + ' updateSebab=' + (r.updateSebab || '(kosong)'));

  // 5. Ubah jadi teks dengan fungsi asli index.js.
  const umur = r.update ? (Date.now() - (Number(r.update) > 1e12 ? Number(r.update) : Number(r.update) * 1000)) / 1000 : NaN;
  const teks = headerLaporanBasi(umur, r.updateSebab || r.errSumber);

  console.log('');
  console.log('5. TEKS YANG DILIHAT PENGGUNA:');
  if (teks) for (const baris of teks.split('\n')) if (baris.trim()) console.log('   ' + baris);
  else console.log('   (tidak ada peringatan)');

  console.log('');
  const ok = {
    sebabSampai: !!r.updateSebab,
    teksMuncul: !!teks,
    adaSebabDiTeks: /ENETUNREACH/.test(teks || ''),
    angkaUtuh: (r.total && r.total.nota) === (lap.total && lap.total.nota),
  };
  console.log('  HASIL: ' + JSON.stringify(ok));
  const semua = Object.values(ok).every(Boolean);
  console.log(semua ? '  RANTAI TERBUKTI UTUH' : '  ADA YANG PUTUS');
  process.exit(semua ? 0 : 1);
})().catch((e) => { console.log('FATAL: ' + ((e && e.stack) || e)); process.exit(1); });

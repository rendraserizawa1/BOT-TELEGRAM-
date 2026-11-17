'use strict';
/**
 * BUKTI BUG: laporan marketplace CP tanggal 14/11/2026 hilang di bot.
 *
 * Sumber (proxy CP) punya datanya: 6 nota, omzet 26.583.000.
 * Yang diuji: apa yang dikembalikan modul bot untuk tanggal itu.
 */
const fs = require('fs');
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

const TGL = process.env.TGL_UJI || '2026-11-14';

(async () => {
  const gudang = require('./push-gudang');
  const bridge = require('../ipos-bridge');

  console.log('=== isi gudang (yang didorong agen) ===');
  for (const toko of ['cp', 'nk', 'kefa']) {
    const mp = gudang.ambilSegar(toko, 'jual-marketplace', 1200);
    console.log('  ' + toko.padEnd(5) + ' marketplace: ' + (mp
      ? 'dari=' + mp.dari + ' sampai=' + mp.sampai + ' nota=' + (mp.central ? mp.central.nota : '?')
      : 'TIDAK ADA'));
  }

  console.log('');
  console.log('=== bot minta marketplace CP ' + TGL + ' ===');
  try {
    const r = await bridge.cp.ambilLaporanMarketplace(TGL, TGL);
    console.log('  BERHASIL');
    console.log('    central.nota=' + (r.central ? r.central.nota : '?')
      + '  central.omzet=' + (r.central ? r.central.omzet : '?')
      + '  total=' + r.total + '  nomor=' + r.nomor);
    if (r.central && r.central.nota === 0) {
      console.log('    ^^ KOSONG padahal sumber punya 6 nota / 26.583.000  <== BUG');
    }
  } catch (e) {
    console.log('  GAGAL (error): ' + e.message);
    console.log('    ^^ ini yang dilihat pengguna sebagai laporan tidak bisa diambil');
  }

  console.log('');
  console.log('=== bandingkan: bot minta tanggal HARI INI ===');
  const d = new Date();
  const hari = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  try {
    const r = await bridge.cp.ambilLaporanMarketplace(hari, hari);
    console.log('  ' + hari + ' -> central.nota=' + (r.central ? r.central.nota : '?') + ' omzet=' + (r.central ? r.central.omzet : '?'));
  } catch (e) {
    console.log('  ' + hari + ' -> GAGAL: ' + e.message);
  }
})().catch((e) => { console.log('FATAL: ' + ((e && e.stack) || e)); process.exit(1); });

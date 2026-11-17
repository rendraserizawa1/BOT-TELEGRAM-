'use strict';
/**
 * Berapa penjualan CP yang HILANG karena kebekuan?
 *
 * Membandingkan jam nota terakhir yang ada di data dengan jam beku (`update`).
 * Kalau nota terakhir jauh SEBELUM jam beku, berarti toko sudah tutup dan
 * tidak ada penjualan yang hilang. Kalau nota terakhir dekat/sesudah jam beku,
 * ada penjualan yang tidak tercatat.
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

function ambilJson(url, timeout) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: 'GET',
    }, (res) => {
      const p = [];
      res.on('data', (d) => p.push(d));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(p).toString('utf8'))); }
        catch (e) { reject(new Error('bukan JSON')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout || 90000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

const jam = (ms) => new Date(ms).toLocaleString('id-ID', { hour12: false });
const tglLokal = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

(async () => {
  const hari = tglLokal();
  const r = await ambilJson(process.env.IPOS_URL + '/api/jual?dari=' + hari + '&sampai=' + hari + '&key=' + encodeURIComponent(process.env.IPOS_KEY));
  console.log('=== penjualan CP yang mungkin hilang karena kebekuan ===');
  console.log('  field laporan: ' + Object.keys(r).join(', '));

  const upd = Number(r.update);
  const bekuMs = upd > 1e12 ? upd : upd * 1000;
  console.log('');
  console.log('  jam beku (update terakhir) : ' + jam(bekuMs));
  console.log('  sekarang                   : ' + jam(Date.now()));
  console.log('  lama beku                  : ' + Math.round((Date.now() - bekuMs) / 60000) + ' menit');
  console.log('  nota hari ini              : ' + (r.total && r.total.nota) + '  omzet: ' + (r.total && r.total.omzet));

  // Cari daftar nota dan waktu terakhirnya.
  const daftar = Array.isArray(r.nota) ? r.nota : (Array.isArray(r.data) ? r.data : null);
  if (!daftar) {
    console.log('');
    console.log('  (laporan tidak memuat daftar nota; hanya ringkasan)');
    const kunci = r.kasir ? 'kasir' : null;
    if (kunci) {
      console.log('  per kasir:');
      for (const k of r.kasir) {
        console.log('    ' + String(k.user || k.nama || '-').padEnd(16)
          + ' nota=' + k.nota + '  omzet=' + k.omzet + (k.terakhir ? '  terakhir=' + k.terakhir : ''));
      }
    }
    return;
  }

  const waktu = daftar.map((x) => String(x.tgl || '')).filter(Boolean).sort();
  console.log('');
  console.log('  nota paling awal  : ' + waktu[0]);
  console.log('  nota paling akhir : ' + waktu[waktu.length - 1]);

  const akhir = Date.parse(String(waktu[waktu.length - 1]).replace(' ', 'T'));
  if (Number.isFinite(akhir)) {
    const selisihMenit = Math.round((bekuMs - akhir) / 60000);
    console.log('');
    console.log('  jarak nota terakhir ke jam beku: ' + selisihMenit + ' menit');
    if (selisihMenit <= 5) {
      console.log('  >>> PERINGATAN: nota terakhir sangat dekat dengan jam beku.');
      console.log('      Kemungkinan ADA penjualan setelah itu yang tidak tercatat.');
    } else {
      console.log('  >>> Toko tampaknya sudah berhenti berjualan ' + selisihMenit + ' menit sebelum beku,');
      console.log('      sehingga laporan hari ini kemungkinan besar LENGKAP.');
    }
  }
})().catch((e) => { console.log('FATAL: ' + ((e && e.stack) || e)); process.exit(1); });

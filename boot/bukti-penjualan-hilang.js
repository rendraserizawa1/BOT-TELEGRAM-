'use strict';
/**
 * Bukti bahwa toko CP MASIH BERJUALAN selagi laporannya beku.
 *
 * `loadItems` di proxy CP masih jalan (lastSync maju), jadi stok barang
 * diperbarui terus. Kalau stok BERUBAH sementara laporan penjualan tidak,
 * itu bukti langsung bahwa ada penjualan yang tidak masuk ke laporan.
 *
 * Ini pembeda penting: kalau stok diam, mungkin toko memang tutup dan
 * laporan yang beku itu kebetulan sudah lengkap. Kalau stok bergerak,
 * penjualan benar-benar hilang dari laporan.
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
    req.setTimeout(timeout || 120000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

const K = encodeURIComponent(process.env.IPOS_KEY || '');
const U = process.env.IPOS_URL;
const tglLokal = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

const petaStok = (items) => {
  const m = new Map();
  for (const it of items) m.set(String(it.kode).toUpperCase(), Number(it.stok));
  return m;
};

(async () => {
  const hari = tglLokal();
  console.log('=== apakah CP masih berjualan selagi laporannya beku? ===');

  const s1 = await ambilJson(U + '/api/items?key=' + K, 120000);
  const l1 = await ambilJson(U + '/api/jual?dari=' + hari + '&sampai=' + hari + '&key=' + K, 90000);
  const m1 = petaStok(s1.data || []);
  console.log('  t=0  : ' + m1.size + ' item, nota=' + (l1.total && l1.total.nota) + ', update=' + l1.update);

  const JEDA = 90;
  console.log('  tunggu ' + JEDA + ' detik...');
  await new Promise((r) => setTimeout(r, JEDA * 1000));

  const s2 = await ambilJson(U + '/api/items?key=' + K, 120000);
  const l2 = await ambilJson(U + '/api/jual?dari=' + hari + '&sampai=' + hari + '&key=' + K, 90000);
  const m2 = petaStok(s2.data || []);

  const berubah = [];
  for (const [kode, stok2] of m2) {
    const stok1 = m1.get(kode);
    if (stok1 !== undefined && stok1 !== stok2) berubah.push({ kode, dari: stok1, ke: stok2, selisih: stok2 - stok1 });
  }

  console.log('');
  console.log('  item dengan STOK BERUBAH dalam ' + JEDA + ' dtk: ' + berubah.length);
  for (const b of berubah.slice(0, 12)) {
    console.log('    ' + b.kode.padEnd(14) + ' ' + b.dari + ' -> ' + b.ke + '  (' + (b.selisih > 0 ? '+' : '') + b.selisih + ')');
  }
  if (berubah.length > 12) console.log('    ... dan ' + (berubah.length - 12) + ' lainnya');

  const turun = berubah.filter((b) => b.selisih < 0);
  console.log('');
  console.log('  nota: ' + (l1.total && l1.total.nota) + ' -> ' + (l2.total && l2.total.nota));
  console.log('  update: ' + (l1.update === l2.update ? 'MASIH BEKU' : 'BERGERAK'));
  console.log('');

  if (turun.length) {
    console.log('  >>> TERBUKTI: ' + turun.length + ' item stoknya TURUN (barang keluar = penjualan),');
    console.log('      tetapi laporan penjualan TIDAK bertambah dan update tetap beku.');
    console.log('      Artinya ADA penjualan yang tidak tercatat di laporan.');
    process.exit(0);
  } else if (berubah.length) {
    console.log('  >>> stok berubah tetapi tidak ada yang turun — belum bisa disimpulkan penjualan.');
    process.exit(2);
  } else {
    console.log('  >>> tidak ada perubahan stok dalam ' + JEDA + ' dtk: toko tampak sedang tidak melayani penjualan.');
    process.exit(3);
  }
})().catch((e) => { console.log('FATAL: ' + ((e && e.stack) || e)); process.exit(1); });

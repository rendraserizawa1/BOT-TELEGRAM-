'use strict';
/**
 * Seberapa parah galat `normJual is not defined` di proxy NK?
 *
 * /health NK melaporkan `jual.err = "normJual is not defined"` padahal
 * `/api/jual` NK tetap segar. Itu berarti galatnya ada di JALUR LAIN. Skrip ini
 * memeriksa jalur mana yang benar-benar rusak, supaya tidak salah menuduh dan
 * tidak melewatkan laporan yang diam-diam kosong.
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

function get(url, timeout) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: 'GET',
    }, (res) => {
      const p = [];
      res.on('data', (d) => p.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(p).toString('utf8') }));
    });
    req.on('error', (e) => resolve({ status: 0, body: e.message }));
    req.setTimeout(timeout || 60000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

const tglLokal = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

(async () => {
  const hari = tglLokal();
  const K = encodeURIComponent(process.env.IPOS_NK_KEY || '');
  const U = process.env.IPOS_NK_URL;
  console.log('=== dampak galat "normJual is not defined" di proxy NK ===');
  console.log('');

  for (const jalur of ['/api/jual', '/api/jual-merek', '/api/jual-marketplace']) {
    const r = await get(U + jalur + '?dari=' + hari + '&sampai=' + hari + '&key=' + K, 90000);
    let ket = '';
    if (r.status === 200) {
      try {
        const j = JSON.parse(r.body);
        const bagian = [];
        if (j.total) bagian.push('total=' + JSON.stringify(j.total));
        if (j.err) bagian.push('err=' + j.err);
        if (j.update) bagian.push('update=' + j.update);
        if (j.data) bagian.push('baris=' + (Array.isArray(j.data) ? j.data.length : '?'));
        if (j.toko) bagian.push('toko=' + (Array.isArray(j.toko) ? j.toko.length : '?'));
        ket = bagian.join('  ');
      } catch (_) { ket = '(bukan JSON)'; }
    }
    console.log('  ' + jalur.padEnd(22) + ' HTTP ' + (r.status || 'gagal') + '  ' + ket);
  }

  console.log('');
  console.log('=== apakah laporan NK BERGERAK (bukan beku)? ===');
  const a = JSON.parse((await get(U + '/api/jual?dari=' + hari + '&sampai=' + hari + '&key=' + K, 90000)).body);
  await new Promise((r) => setTimeout(r, 8000));
  const b = JSON.parse((await get(U + '/api/jual?dari=' + hari + '&sampai=' + hari + '&key=' + K, 90000)).body);
  console.log('  update: ' + (a.update === b.update ? 'BEKU' : 'BERGERAK +' + (b.update - a.update) + 'ms'));
  console.log('  nota  : ' + (a.total && a.total.nota) + ' -> ' + (b.total && b.total.nota));

  console.log('');
  console.log('=== /health NK: apa kata proxy-nya sendiri ===');
  const h = JSON.parse((await get(U + '/health?key=' + K, 25000)).body);
  console.log('  ok=' + h.ok + '  lastError=' + (h.lastError || '-'));
  for (const n of ['jual', 'jualPromo']) {
    if (h[n]) console.log('  ' + n + ': umurDetik=' + h[n].umurDetik + ' nota=' + h[n].nota + ' err=' + (h[n].err || '-'));
  }
})();

'use strict';
/**
 * Cari jalur PEMULIHAN di proxy toko tanpa pernah mencetak kunci.
 *
 * Kunci hanya dipakai di dalam proses; yang dicetak hanya status HTTP dan
 * berapa lama `update` bergerak. Tidak ada satu baris pun yang memuat kunci.
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
      hostname: u.hostname, port: u.port || 80,
      path: u.pathname + u.search, method: 'GET',
    }, (res) => {
      const p = [];
      res.on('data', (d) => p.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(p).toString('utf8') }));
    });
    req.on('error', (e) => resolve({ status: 0, body: e.message }));
    req.setTimeout(timeout || 25000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

const K = encodeURIComponent(process.env.IPOS_KEY || '');
const U = process.env.IPOS_URL;
const TGL = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
const dasar = '/api/jual?dari=' + TGL + '&sampai=' + TGL;

(async () => {
  console.log('=== jalur yang dicoba (nama saja, tanpa kunci) ===');
  const jalur = [
    '/api/jual-reload', '/api/reload', '/api/refresh', '/api/jual/muat-ulang',
    '/api/jual?paksa=1', '/api/jual-rekon', '/api/health',
  ];
  for (const p of jalur) {
    const pemisah = p.includes('?') ? '&' : '?';
    const r = await get(U + p + pemisah + 'key=' + K, 25000);
    let ket = '';
    if (r.status === 200) {
      try {
        const j = JSON.parse(r.body);
        ket = ' (JSON, kunci: ' + Object.keys(j).slice(0, 6).join(',') + ')';
      } catch (_) { ket = ' (bukan JSON)'; }
    }
    console.log('  ' + p.padEnd(28) + ' -> HTTP ' + (r.status || 'gagal') + ket);
  }

  console.log('');
  console.log('=== apakah `update` bergerak setelah itu? ===');
  const a = JSON.parse((await get(U + dasar + '&key=' + K, 40000)).body);
  await new Promise((r) => setTimeout(r, 10000));
  const b = JSON.parse((await get(U + dasar + '&key=' + K, 40000)).body);
  const umur = Math.round((Date.now() - Number(b.update)) / 1000);
  console.log('  update ' + (a.update === b.update ? 'MASIH BEKU' : 'BERGERAK') + '  umur=' + umur + ' dtk  nota=' + (b.total && b.total.nota));

  console.log('');
  console.log('=== isi /health: sumber mana yang galat? ===');
  const h = JSON.parse((await get(U + '/health?key=' + K, 25000)).body);
  console.log('  ok=' + h.ok + '  lastError=' + (h.lastError || '-') + '  items=' + h.items);
  for (const nama of ['jual', 'jualPromo']) {
    const j = h[nama];
    if (!j) continue;
    console.log('  ' + nama + ': umurDetik=' + j.umurDetik + ' nota=' + j.nota + ' err=' + (j.err || '-'));
    console.log('    jangkauan=' + j.dari + ' s/d ' + j.sampai + '  lastNo=' + JSON.stringify(j.lastNo || {}));
    if (j.rekon) console.log('    rekon: hari=' + j.rekon.hari + ' beda=' + j.rekon.beda + ' detikLalu=' + j.rekon.detikLalu);
  }
})();

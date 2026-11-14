'use strict';
/**
 * Ringkas: apakah DB sentral CP punya data LEBIH BARU daripada yang disajikan proxy CP?
 * Output satu baris per fakta. Kredensial tidak pernah dicetak.
 */

const fs = require('fs');
const { Client } = require('C:\\Users\\rdpadmin\\ipos-api\\node_modules\\pg');

function bacaEnv(file) {
  const out = {};
  for (const baris of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = baris.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const env = bacaEnv('C:\\Users\\rdpadmin\\ipos-api\\.env');
const baris = [];

async function cek(db) {
  const c = new Client({
    host: '192.168.77.250', port: 5444,
    user: env.PGUSER, password: env.PGPASSWORD, database: db,
    connectionTimeoutMillis: 15000, query_timeout: 25000,
    application_name: 'kefa-ringkas',
  });
  await c.connect();
  const r = await c.query(
    'SELECT notransaksi, tanggal FROM tbl_ikhd ORDER BY tanggal DESC LIMIT 1'
  );
  const n = await c.query(
    "SELECT count(*)::int AS n FROM tbl_ikhd WHERE tanggal >= current_date"
  );
  const tot = await c.query('SELECT count(*)::int AS n FROM tbl_ikhd');
  await c.end();
  const row = r.rows[0];
  const tgl = row && row.tanggal instanceof Date ? row.tanggal : null;
  baris.push(db + ' | nota terbaru=' + (row ? row.notransaksi : '-') +
    ' | waktu=' + (tgl ? tgl.toISOString() : '-') +
    ' | umur=' + (tgl ? Math.round((Date.now() - tgl.getTime()) / 60000) : '?') + ' menit' +
    ' | nota hari ini=' + n.rows[0].n + ' | total nota=' + tot.rows[0].n);
}

(async () => {
  baris.push('SEKARANG(UTC) | ' + new Date().toISOString());
  baris.push('PROXY CP sajikan | update=2026-11-14T08:13:41Z (beku)');
  for (const db of ['i5_CP2026', 'i5_CP2025']) {
    try { await cek(db); } catch (e) { baris.push(db + ' | GAGAL: ' + e.message); }
  }
  fs.writeFileSync('C:\\BOT-TELEGRAM-\\boot\\out-ringkas.json', JSON.stringify(baris, null, 1), 'utf8');
  console.log('OK ' + baris.length + ' baris -> boot\\out-ringkas.json');
})();

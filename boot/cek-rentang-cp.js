'use strict';
/**
 * Rentang data KSR/JL di i5_CP2025 dan i5_CP2026, untuk memutuskan apakah
 * riwayat 2025 perlu dimuat agar `jangkauan` setara proxy CP asli.
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
const out = [];

async function cek(db) {
  const c = new Client({
    host: '192.168.77.250', port: 5444, user: env.PGUSER, password: env.PGPASSWORD,
    database: db, connectionTimeoutMillis: 15000, query_timeout: 60000,
    application_name: 'kefa-rentang',
  });
  await c.connect();
  try {
    const r = await c.query(
      `SELECT count(*)::int n,
              to_char(min(tanggal),'YYYY-MM-DD') a,
              to_char(max(tanggal),'YYYY-MM-DD') b
         FROM tbl_ikhd WHERE tipe IN ('KSR','JL')`
    );
    out.push(db + ' KSR/JL: n=' + r.rows[0].n + ' dari=' + r.rows[0].a + ' sampai=' + r.rows[0].b);
    // per tahun
    const y = await c.query(
      `SELECT to_char(tanggal,'YYYY') th, count(*)::int n
         FROM tbl_ikhd WHERE tipe IN ('KSR','JL') GROUP BY 1 ORDER BY 1`
    );
    out.push('  per tahun: ' + y.rows.map((x) => x.th + '=' + x.n).join(', '));
  } catch (e) {
    out.push(db + ' GAGAL: ' + e.message);
  } finally {
    try { await c.end(); } catch (_) {}
  }
}

(async () => {
  for (const db of ['i5_CP2026', 'i5_CP2025', 'i5_PROMO2025']) {
    try { await cek(db); } catch (e) { out.push(db + ' GAGAL connect: ' + e.message); }
  }
  fs.writeFileSync('C:\\BOT-TELEGRAM-\\boot\\out-rentang.json', JSON.stringify(out, null, 1), 'utf8');
  console.log('OK');
})();

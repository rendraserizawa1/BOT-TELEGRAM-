'use strict';
/**
 * Cari kunci unik yang aman untuk penggabungan i5_CP2025 + i5_CP2026.
 * Uji: apakah (notransaksi, tanggal) unik di dalam satu DB?
 * Jika tidak, perlu tambahan kodekantor/tipe.
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

function konek(db) {
  return new Client({
    host: '192.168.77.250', port: 5444, user: env.PGUSER, password: env.PGPASSWORD,
    database: db, connectionTimeoutMillis: 15000, query_timeout: 180000,
    application_name: 'kefa-kunci',
  });
}

async function cek(db) {
  const c = konek(db);
  await c.connect();
  try {
    const r = await c.query(`
      SELECT count(*)::int total,
             count(DISTINCT notransaksi)::int unik_nota,
             count(DISTINCT (notransaksi || '|' || to_char(tanggal,'YYYY-MM-DD')))::int unik_nota_tgl,
             count(DISTINCT (notransaksi || '|' || to_char(tanggal,'YYYY-MM-DD') || '|' || coalesce(tipe,'')))::int unik_nota_tgl_tipe
        FROM tbl_ikhd WHERE tipe IN ('KSR','JL')`);
    const x = r.rows[0];
    out.push(db + ':');
    out.push('  total baris            = ' + x.total);
    out.push('  unik notransaksi       = ' + x.unik_nota);
    out.push('  unik nota+tanggal      = ' + x.unik_nota_tgl);
    out.push('  unik nota+tgl+tipe     = ' + x.unik_nota_tgl_tipe);
  } catch (e) {
    out.push(db + ' GAGAL: ' + e.message);
  } finally {
    try { await c.end(); } catch (_) {}
  }
}

(async () => {
  for (const db of ['i5_CP2025', 'i5_CP2026', 'i5_PROMO2025']) {
    try { await cek(db); } catch (e) { out.push(db + ' GAGAL connect: ' + e.message); }
  }
  fs.writeFileSync('C:\\BOT-TELEGRAM-\\boot\\out-kunci.json', JSON.stringify(out, null, 1), 'utf8');
  console.log('OK');
})();

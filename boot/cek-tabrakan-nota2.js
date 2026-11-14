'use strict';
/**
 * 696 notransaksi bertabrakan antara i5_CP2025 & i5_CP2026.
 * Apakah isinya IDENTIK (aman digabung) atau BERBEDA (harus dipisah)?
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
    database: db, connectionTimeoutMillis: 15000, query_timeout: 120000,
    application_name: 'kefa-tabrakan2',
  });
}

const Q = `SELECT notransaksi, to_char(tanggal,'YYYY-MM-DD HH24:MI') tgl,
                  coalesce(totalitem,0) item, coalesce(totalakhir,0) omzet, tipe
             FROM tbl_ikhd WHERE tipe IN ('KSR','JL')`;

(async () => {
  const c25 = konek('i5_CP2025'); await c25.connect();
  const a = await c25.query(Q); await c25.end();
  const c26 = konek('i5_CP2026'); await c26.connect();
  const b = await c26.query(Q); await c26.end();

  const map26 = new Map(b.rows.map((r) => [r.notransaksi, r]));
  let identik = 0, beda = 0;
  const contohBeda = [];
  let omzet25 = 0, omzet26 = 0;
  for (const r of a.rows) {
    const t = map26.get(r.notransaksi);
    if (!t) continue;
    omzet25 += Number(r.omzet) || 0;
    omzet26 += Number(t.omzet) || 0;
    if (r.tgl === t.tgl && Number(r.item) === Number(t.item) && Number(r.omzet) === Number(t.omzet)) {
      identik++;
    } else {
      beda++;
      if (contohBeda.length < 5) {
        contohBeda.push(`${r.notransaksi} | 2025: ${r.tgl} item=${r.item} omzet=${r.omzet} | 2026: ${t.tgl} item=${t.item} omzet=${t.omzet}`);
      }
    }
  }
  out.push('tabrakan total = ' + (identik + beda));
  out.push('isinya IDENTIK = ' + identik);
  out.push('isinya BERBEDA = ' + beda);
  out.push('omzet di CP2025 (baris bertabrakan) = ' + omzet25);
  out.push('omzet di CP2026 (baris bertabrakan) = ' + omzet26);
  out.push('');
  for (const c of contohBeda) out.push('  ' + c);
  fs.writeFileSync('C:\\BOT-TELEGRAM-\\boot\\out-tabrakan2.json', JSON.stringify(out, null, 1), 'utf8');
  console.log('OK');
})();

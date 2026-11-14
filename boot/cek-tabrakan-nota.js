'use strict';
/**
 * Cek tabrakan notransaksi antara i5_CP2025 dan i5_CP2026.
 * Kalau ada tabrakan, penggabungan akan MENGHILANGKAN data -> harus diketahui.
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
    application_name: 'kefa-tabrakan',
  });
}

(async () => {
  const c25 = konek('i5_CP2025');
  await c25.connect();
  const a = await c25.query(
    "SELECT notransaksi FROM tbl_ikhd WHERE tipe IN ('KSR','JL')"
  );
  await c25.end();

  const c26 = konek('i5_CP2026');
  await c26.connect();
  const b = await c26.query(
    "SELECT notransaksi FROM tbl_ikhd WHERE tipe IN ('KSR','JL')"
  );
  await c26.end();

  const set26 = new Set(b.rows.map((r) => r.notransaksi));
  let tabrakan = 0;
  const contoh = [];
  for (const r of a.rows) {
    if (set26.has(r.notransaksi)) {
      tabrakan++;
      if (contoh.length < 8) contoh.push(r.notransaksi);
    }
  }
  out.push('i5_CP2025 KSR/JL = ' + a.rows.length);
  out.push('i5_CP2026 KSR/JL = ' + b.rows.length);
  out.push('notransaksi BERTABRAKAN = ' + tabrakan);
  if (contoh.length) out.push('contoh tabrakan: ' + contoh.join(', '));
  out.push('total unik bila digabung = ' + (new Set([...a.rows.map((r) => r.notransaksi), ...set26])).size);
  fs.writeFileSync('C:\\BOT-TELEGRAM-\\boot\\out-tabrakan.json', JSON.stringify(out, null, 1), 'utf8');
  console.log('OK');
})();

'use strict';
/**
 * Periksa struktur DB CP: dari mana item, dari mana jual, dan bentuk data promo.
 * Hanya mencetak nama kolom/angka. Kredensial tidak pernah dicetak.
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
    host: '192.168.77.250', port: 5444,
    user: env.PGUSER, password: env.PGPASSWORD, database: db,
    connectionTimeoutMillis: 15000, query_timeout: 30000,
    application_name: 'kefa-struktur',
  });
}

async function periksa(db) {
  out.push('===== DATABASE ' + db + ' =====');
  const c = konek(db);
  try { await c.connect(); } catch (e) { out.push('  GAGAL: ' + e.message); return; }

  try {
    // 1. Kolom tbl_ikhd
    const kol = await c.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='tbl_ikhd' ORDER BY ordinal_position"
    );
    out.push('  tbl_ikhd kolom (' + kol.rows.length + '): ' + kol.rows.map((r) => r.column_name).join(','));

    // 2. Sebaran tipe nota
    const tipe = await c.query(
      'SELECT tipe, count(*)::int n FROM tbl_ikhd GROUP BY tipe ORDER BY n DESC'
    );
    out.push('  tipe nota: ' + tipe.rows.map((r) => r.tipe + '=' + r.n).join(', '));

    // 3. Sebaran kantor
    const kantor = await c.query(
      'SELECT kantor, count(*)::int n FROM tbl_ikhd GROUP BY kantor ORDER BY n DESC LIMIT 12'
    );
    out.push('  kantor: ' + kantor.rows.map((r) => r.kantor + '=' + r.n).join(', '));

    // 4. tbl_kantor
    const tk = await c.query('SELECT kodekantor, namakantor FROM tbl_kantor ORDER BY kodekantor');
    out.push('  tbl_kantor: ' + tk.rows.map((r) => r.kodekantor + ':' + (r.namakantor || '')).join(' | '));

    // 5. Jumlah item & user
    const it = await c.query('SELECT count(*)::int n FROM tbl_item');
    out.push('  tbl_item: ' + it.rows[0].n);
    const us = await c.query('SELECT userid, nama, kelompok FROM tbl_user ORDER BY userid');
    out.push('  tbl_user (' + us.rows.length + '): ' + us.rows.map((r) => r.userid + '/' + (r.kelompok || '-')).join(', '));

    // 6. Nota terbaru + nomor seri
    const nb = await c.query('SELECT notransaksi, tipe, tanggal FROM tbl_ikhd ORDER BY tanggal DESC LIMIT 5');
    for (const r of nb.rows) {
      const t = r.tanggal instanceof Date ? r.tanggal.toISOString() : String(r.tanggal);
      out.push('  nota terbaru: ' + r.notransaksi + ' tipe=' + r.tipe + ' ' + t);
    }
  } catch (e) {
    out.push('  GAGAL query: ' + e.message);
  } finally {
    try { await c.end(); } catch (_) {}
  }
  out.push('');
}

(async () => {
  await periksa('i5_CP2026');
  await periksa('i5_PROMO2025');
  fs.writeFileSync('C:\\BOT-TELEGRAM-\\boot\\out-struktur.json', JSON.stringify(out, null, 1), 'utf8');
  console.log('OK ' + out.length + ' baris');
})();

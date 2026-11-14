'use strict';
/**
 * Lanjutan struktur: item, kantor, dan bukti bahwa SEMUA data CP ada di sentral.
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
    application_name: 'kefa-struktur2',
  });
}

async function periksa(db) {
  out.push('===== ' + db + ' =====');
  const c = konek(db);
  try { await c.connect(); } catch (e) { out.push('  GAGAL: ' + e.message); return; }
  try {
    const it = await c.query('SELECT count(*)::int n FROM tbl_item');
    out.push('  tbl_item: ' + it.rows[0].n);
    const ita = await c.query("SELECT count(*)::int n FROM tbl_item WHERE coalesce(statushapus,'')<>'Y'");
    out.push('  tbl_item aktif: ' + ita.rows[0].n);

    const kk = await c.query(
      'SELECT kodekantor, count(*)::int n FROM tbl_ikhd GROUP BY kodekantor ORDER BY n DESC LIMIT 10'
    );
    out.push('  kodekantor: ' + kk.rows.map((r) => r.kodekantor + '=' + r.n).join(', '));

    const tk = await c.query('SELECT kodekantor, namakantor FROM tbl_kantor ORDER BY kodekantor');
    out.push('  tbl_kantor: ' + tk.rows.map((r) => r.kodekantor + ':' + (r.namakantor || '')).join(' | '));

    const us = await c.query('SELECT userid, nama, kelompok FROM tbl_user ORDER BY userid');
    out.push('  tbl_user(' + us.rows.length + '): ' + us.rows.map((r) => r.userid + '/' + (r.kelompok || '-')).join(', '));

    const nb = await c.query(
      "SELECT notransaksi, tipe, kodekantor, tanggal FROM tbl_ikhd ORDER BY tanggal DESC LIMIT 4"
    );
    for (const r of nb.rows) {
      const t = r.tanggal instanceof Date ? r.tanggal.toISOString() : String(r.tanggal);
      out.push('  terbaru: ' + r.notransaksi + ' tipe=' + r.tipe + ' kantor=' + r.kodekantor + ' ' + t);
    }

    const hd = await c.query("SELECT count(*)::int n FROM tbl_ikhd WHERE tanggal >= current_date");
    out.push('  nota hari ini: ' + hd.rows[0].n);
  } catch (e) {
    out.push('  GAGAL: ' + e.message);
  } finally {
    try { await c.end(); } catch (_) {}
  }
  out.push('');
}

(async () => {
  await periksa('i5_CP2026');
  await periksa('i5_PROMO2025');
  fs.writeFileSync('C:\\BOT-TELEGRAM-\\boot\\out-struktur2.json', JSON.stringify(out, null, 1), 'utf8');
  console.log('OK ' + out.length + ' baris');
})();

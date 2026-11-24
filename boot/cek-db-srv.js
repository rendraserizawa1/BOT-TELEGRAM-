'use strict';
/**
 * PERIKSA DATABASE iPos DI SRV KEFA
 *
 * Menjawab satu pertanyaan yang menentukan bentuk migrasi:
 *   Apakah database KETIGA toko (CP, NK, KEFA) ada di SRV KEFA,
 *   atau hanya KEFA?
 *
 * Kredensial dibaca dari .env proxy lokal dan TIDAK PERNAH dicetak.
 * Hanya daftar nama database dan ukurannya yang ditampilkan.
 *
 * Jalankan: node boot/cek-db-srv.js
 */
const fs = require('fs');
const path = require('path');

function bacaEnv(berkas) {
  const hasil = {};
  if (!fs.existsSync(berkas)) return hasil;
  for (const baris of fs.readFileSync(berkas, 'utf8').split(/\r?\n/)) {
    const m = baris.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) hasil[m[1]] = m[2].trim();
  }
  return hasil;
}

const envProxy = bacaEnv('C:\\Users\\rdpadmin\\ipos-api\\.env');
const host = envProxy.PGHOST || 'SRV';
const port = Number(envProxy.PGPORT || 5444);
const user = envProxy.PGUSER;
const pass = envProxy.PGPASSWORD;
const db = envProxy.PGDATABASE;

console.log('=== CEK DATABASE iPos DI SRV KEFA ===');
console.log('  host : ' + host + ':' + port);
console.log('  user : ' + user);
console.log('  db   : ' + db);
console.log('  pass : ' + (pass ? 'ADA (' + pass.length + ' karakter, tidak dicetak)' : 'TIDAK ADA'));
console.log('');

// Cari modul pg — bisa di folder proxy atau di folder bot.
let pg = null;
const kandidat = [
  'C:\\Users\\rdpadmin\\ipos-api\\node_modules\\pg',
  path.join(__dirname, '..', 'node_modules', 'pg'),
];
for (const k of kandidat) {
  try { pg = require(k); console.log('  modul pg: ' + k); break; } catch (_) {}
}
if (!pg) {
  console.log('  GAGAL: modul pg tidak ditemukan. Diperiksa:');
  kandidat.forEach((k) => console.log('    ' + k));
  process.exit(1);
}
console.log('');

const klien = new pg.Client({ host, port, user, password: pass, database: db, connectionTimeoutMillis: 15000 });

(async () => {
  try {
    await klien.connect();
    console.log('  TERSAMBUNG ke PostgreSQL di SRV KEFA');
    console.log('');

    const v = await klien.query('SELECT version() AS v');
    console.log('  versi: ' + String(v.rows[0].v).split(',')[0]);

    const dbs = await klien.query(
      'SELECT datname, pg_size_pretty(pg_database_size(datname)) AS ukuran ' +
      'FROM pg_database WHERE datistemplate = false ORDER BY datname'
    );
    console.log('');
    console.log('  DATABASE yang ada di server ini:');
    for (const r of dbs.rows) {
      const tanda = /kefa/i.test(r.datname) ? ' <-- KEFA'
        : /nasional|^i5_nk|nk20/i.test(r.datname) ? ' <-- mungkin NK'
        : /perabot|cp20|^i5_cp/i.test(r.datname) ? ' <-- mungkin CP'
        : '';
      console.log('    ' + String(r.datname).padEnd(28) + ' ' + String(r.ukuran).padStart(10) + tanda);
    }

    const jumlah = dbs.rows.length;
    console.log('');
    console.log('  jumlah database: ' + jumlah);

    // Perkiraan: apakah ada lebih dari satu database toko?
    const toko = dbs.rows.filter((r) => /i5_/i.test(r.datname));
    console.log('  database berpola i5_*: ' + toko.length + ' (' + toko.map((r) => r.datname).join(', ') + ')');

    await klien.end();
  } catch (e) {
    console.log('  GAGAL: ' + (e && e.message ? e.message : String(e)));
    try { await klien.end(); } catch (_) {}
    process.exit(1);
  }
})();

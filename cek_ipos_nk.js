'use strict';
// Ambil daftar item iPos NK (read-only) utk cek nama asli pool matching.
// Jalankan: node cek_ipos_nk.js [KATA KUNCI]
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
const g = (k) => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim() : ''; };
const url = g('IPOS_NK_URL').replace(/\/+$/, '');
const key = g('IPOS_NK_KEY');

(async () => {
  const res = await fetch(`${url}/api/items?key=${encodeURIComponent(key)}`);
  if (!res.ok) { console.error('HTTP', res.status); process.exit(1); }
  const j = await res.json();
  const d = Array.isArray(j.data) ? j.data : [];
  console.log('total iPos NK:', d.length);
  fs.writeFileSync(path.join(__dirname, 'storage', 'ipos_nk_items.json'), JSON.stringify(d));

  const kata = process.argv[2]
    ? [process.argv.slice(2).join(' ')]
    : ['KURSI BAKSO', 'NAPOLLY', 'KURATSEN', 'DONAT', 'SEAL'];
  for (const k of kata) {
    const hit = d.filter(x => String(x.nama || '').toUpperCase().includes(k.toUpperCase()));
    console.log(`\n[${k}] ${hit.length} item`);
    hit.slice(0, 15).forEach(x => console.log(`   ${x.kode} | ${x.nama} | hpp=${x.hpp}`));
  }
  console.log('\nTersimpan: storage/ipos_nk_items.json');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

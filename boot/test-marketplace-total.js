'use strict';
// ════════════════════════════════════════════════════════════════════════
// UJI REGRESI: TOTAL OMZET LAPORAN MARKETPLACE
//
// Bug yang dijaga: tampilan memakai `r.central.omzet` / `r.total` untuk semua
// toko. Bentuk respons iPos BERBEDA antar toko:
//   CP        : omzet ada di `central`; `toko[]` = toko pasangan (omzet 0)
//   NK / KEFA : `central` SELALU kosong; omzet asli ada di `toko[]`; r.total = 0
// Akibatnya NK menampilkan "Total Penjualan Rp 0" padahal ada penjualan
// Rp 45.911.500 (30 hari). Uji ini memakai bentuk respons ASLI dari ketiga toko.
// ════════════════════════════════════════════════════════════════════════
const fs = require('fs');

const env = {};
for (const line of fs.readFileSync('C:/BOT-TELEGRAM-/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (!m) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}

// ── Logika BARU, disalin persis dari index.js (harus dijaga sinkron) ──
function hitungTotalMp(r, isNk, isKefa) {
  const tokoMp = Array.isArray(r.toko) ? r.toko : [];
  const c = r.central || { nota: 0, omzet: 0, tunai: 0, debit: 0, notas: [] };
  const sumTokoMp = tokoMp.reduce((s, x) => s + (Number(x.omzet) || 0), 0);
  const centralOmzet = Number(c.omzet) || 0;
  const totalResmi = Number(r.total) || 0;
  const totalOmzetMp = (isNk || isKefa)
    ? (totalResmi || centralOmzet || sumTokoMp)
    : (totalResmi || centralOmzet);
  const notas = Array.isArray(c.notas) ? c.notas : [];
  const adaRincianMp = (Number(c.nota) || 0) > 0 || notas.length > 0;
  return { totalOmzetMp, adaRincianMp };
}

// ── Logika LAMA (untuk membuktikan bug-nya nyata) ──
function hitungTotalMpLama(r) {
  return { totalOmzetMp: Number(r.total) || 0, tunai: (r.central || {}).tunai || 0 };
}

let lulus = 0, gagal = 0;
function cek(nama, kondisi, bukti) {
  if (kondisi) { lulus++; console.log(`  ✅ ${nama}`); }
  else { gagal++; console.log(`  ❌ ${nama}  → ${bukti}`); }
}

const TOKO = [
  { nama: 'cp', url: env.IPOS_URL, key: env.IPOS_KEY, isNk: false, isKefa: false },
  { nama: 'nk', url: env.IPOS_NK_URL, key: env.IPOS_NK_KEY, isNk: true, isKefa: false },
  { nama: 'kefa', url: env.IPOS_KEFA_URL, key: env.IPOS_KEFA_KEY, isNk: false, isKefa: true },
];

const sampai = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
const dari = new Date(Date.now() - 30 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

(async () => {
  console.log(`Periode uji: ${dari} s/d ${sampai} (30 hari)\n`);
  for (const t of TOKO) {
    const base = String(t.url).replace(/\/+$/, '');
    const r = await (await fetch(`${base}/api/jual-marketplace?dari=${dari}&sampai=${sampai}&key=${encodeURIComponent(t.key)}`, { signal: AbortSignal.timeout(60000) })).json();
    console.log(`=== [${t.nama.toUpperCase()}] ===`);
    const lama = hitungTotalMpLama(r);
    const baru = hitungTotalMp(r, t.isNk, t.isKefa);
    const sumToko = (r.toko || []).reduce((s, x) => s + (Number(x.omzet) || 0), 0);
    console.log(`  r.total=${r.total} central.omzet=${(r.central || {}).omzet} sum(toko)=${sumToko}`);
    console.log(`  LAMA  -> Rp ${lama.totalOmzetMp.toLocaleString('id-ID')}`);
    console.log(`  BARU  -> Rp ${baru.totalOmzetMp.toLocaleString('id-ID')}  adaRincian=${baru.adaRincianMp}`);

    // Omzet sebenarnya = nilai terbesar dari ketiga sumber
    const sebenarnya = Math.max(Number(r.total) || 0, Number((r.central || {}).omzet) || 0, sumToko);
    cek(`${t.nama}: total BARU == omzet sebenarnya`, baru.totalOmzetMp === sebenarnya,
      `baru=${baru.totalOmzetMp} sebenarnya=${sebenarnya}`);
    if (sebenarnya > 0) {
      cek(`${t.nama}: BARU tidak melaporkan 0 saat ada penjualan`, baru.totalOmzetMp > 0, `baru=${baru.totalOmzetMp}`);
    }
    // CP harus tetap sama dengan cara lama (tidak ada regresi)
    if (!t.isNk && !t.isKefa) {
      cek(`${t.nama}: tidak ada regresi vs cara lama`, baru.totalOmzetMp === lama.totalOmzetMp,
        `baru=${baru.totalOmzetMp} lama=${lama.totalOmzetMp}`);
    }
    // NK/KEFA: cara lama salah kalau central kosong tapi ada omzet
    if ((t.isNk || t.isKefa) && sebenarnya > 0) {
      cek(`${t.nama}: cara LAMA memang salah (bukti bug)`, lama.totalOmzetMp !== sebenarnya,
        `lama=${lama.totalOmzetMp} sebenarnya=${sebenarnya}`);
    }
    console.log('');
  }
  console.log(`LULUS ${lulus}, GAGAL ${gagal}`);
  process.exit(gagal === 0 ? 0 : 1);
})();

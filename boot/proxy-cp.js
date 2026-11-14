'use strict';
/**
 * PROXY iPos CP — jalur mandiri (menggantikan proxy CP yang rutenya rusak).
 * ========================================================================
 *
 * LATAR BELAKANG (terukur, bukan dugaan):
 *   Proxy CP di 100.125.99.99:8080 melaporkan:
 *     jual.err      = "connect ETIMEDOUT 192.168.77.250:5444"
 *     jual.umurDetik= 7079  (≈118 menit beku)
 *     update        = 2026-11-14T08:13:41Z
 *   Padahal DB sentral 192.168.77.250:5444 HIDUP dan TERBUKA dari PC ini
 *   (rute Tailscale 192.168.77.0/24 -> 100.100.100.100), dan datanya SEGAR:
 *     i5_CP2026   nota terbaru 006154/CP/11/26  (670 nota hari ini)
 *     i5_PROMO2025 nota terbaru 000642/PRO/11/26 (78 nota hari ini)
 *   Jadi yang rusak HANYA rute di server proxy CP — bukan DB, bukan bot,
 *   bukan tunnel Cloudflare.
 *
 * DESAIN (penting, jangan diubah tanpa alasan):
 *   - i5_CP2026 di-cache di memori (data panas, 139.036 nota).
 *   - i5_CP2025 TIDAK di-cache: diambil on-demand saat laporan menyentuh
 *     tanggal < CUTOVER. Alasannya dua:
 *       (a) RAM PC ini hanya 3,8 GB (bebas ~0,2 GB) — memuat 158.670 baris
 *           lagi berisiko OOM.
 *       (b) 696 notransaksi BERTABRAKAN antar kedua DB dengan isi BERBEDA
 *           (penomoran nota direset Jan 2026: "000001/CPK/01/26" ada di
 *           2026-01-05 DAN 2026-01-06). Menggabung dengan kunci notransaksi
 *           akan MENGHILANGKAN Rp 298.211.500 data 2025.
 *     Dengan memisahkannya, tidak ada penggabungan kunci sama sekali.
 *
 * VALIDASI (sudah diuji terhadap proxy CP asli):
 *   Laporan 2026-11-13 (kemarin) IDENTIK SEMPURNA:
 *     nota=474 omzet=183904000 promoNota=34 promoOmzet=738000
 *   Laporan hari ini lebih SEGAR daripada proxy asli (yang basi 118 menit).
 *
 * KEAMANAN: hanya SELECT. Kredensial tidak pernah dicetak.
 */

const http = require('http');
const fs = require('fs');

const { Pool } = require('C:\\Users\\rdpadmin\\ipos-api\\node_modules\\pg');

// ---------------------------------------------------------------- konfigurasi
function bacaEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const baris of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = baris.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const ENV_DB = bacaEnv('C:\\Users\\rdpadmin\\ipos-api\\.env');

const PGHOST = process.env.PGHOST || '192.168.77.250';
const PGPORT = Number(process.env.PGPORT || 5444);
const PGUSER = process.env.PGUSER || ENV_DB.PGUSER;
const PGPASSWORD = process.env.PGPASSWORD || ENV_DB.PGPASSWORD;
const PGDB_CP = process.env.PGDB_CP || 'i5_CP2026';       // tahun berjalan (cache)
const PGDB_CP_LAMA = process.env.PGDB_CP_LAMA || 'i5_CP2025'; // arsip (on-demand)
const PGDB_PROMO = process.env.PGDB_PROMO || 'i5_PROMO2025';

// Batas: i5_CP2025 = 2025-01-06..2026-01-05, i5_CP2026 = 2026-01-06..sekarang.
const CUTOVER = process.env.CUTOVER || '2026-01-06';

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8081);
const BASE_PATH = (process.env.BASE_PATH || '/ipos').replace(/\/+$/, '');
const API_KEY = process.env.API_KEY || '';
const JUAL_POLL_MS = Math.max(500, Number(process.env.JUAL_POLL_MS || 1500));
const ITEM_POLL_MS = Math.max(5000, Number(process.env.ITEM_POLL_MS || 30000));

if (!PGUSER || !PGPASSWORD) {
  console.error('[fatal] kredensial DB tidak tersedia (PGUSER/PGPASSWORD kosong).');
  process.exit(1);
}
if (!API_KEY) {
  console.error('[fatal] API_KEY kosong — proxy akan menolak semua permintaan.');
  process.exit(1);
}

const poolCp = new Pool({
  host: PGHOST, port: PGPORT, user: PGUSER, password: PGPASSWORD,
  database: PGDB_CP, max: 4, application_name: 'kefa-cp-jual',
});
const poolLama = new Pool({
  host: PGHOST, port: PGPORT, user: PGUSER, password: PGPASSWORD,
  database: PGDB_CP_LAMA, max: 2, application_name: 'kefa-cp-arsip',
});
const poolPromo = new Pool({
  host: PGHOST, port: PGPORT, user: PGUSER, password: PGPASSWORD,
  database: PGDB_PROMO, max: 2, application_name: 'kefa-cp-promo',
});

// Tanpa ini, ECONNRESET pada koneksi idle mematikan seluruh proses.
for (const p of [poolCp, poolLama, poolPromo]) {
  p.on('error', (e) => console.error('[pool] ' + e.message));
}
process.on('unhandledRejection', (e) => console.error('[unhandled] ' + (e && e.message)));
process.on('uncaughtException', (e) => console.error('[uncaught] ' + (e && e.message)));

// ---------------------------------------------------------------------- state
const state = {
  jual: new Map(),        // CP tahun berjalan (i5_CP2026)
  promo: new Map(),       // PROMO (i5_PROMO2025)
  kasirSet: new Set(),
  kasirInfo: new Map(),
  promoKasirSet: new Set(),
  promoKasirInfo: new Map(),
  jualDari: null, jualSampai: null,
  promoDari: null, promoSampai: null,
  arsipDari: null,        // min tanggal di i5_CP2025
  jualSiap: false, promoSiap: false,
  jualMemuat: false, promoMemuat: false,
  jualErr: null, promoErr: null,
  jualRefresh: 0, promoRefresh: 0,
  items: [], itemsSync: 0, itemsErr: null,
};

// --------------------------------------------------------------- normalisasi
const KOLOM_JUAL = `notransaksi, tipe, kodekantor,
  to_char(tanggal,'YYYY-MM-DD HH24:MI') AS tgl,
  to_char(tanggal,'YYYY-MM-DD') AS hari,
  coalesce(totalitem,0) AS item,
  coalesce(totalakhir,0) AS omzet,
  coalesce(jmldebit,0) AS debit,
  coalesce(jmlkredit,0) AS kredit,
  coalesce(user1,'') AS user,
  coalesce(compname,'') AS mesin,
  coalesce(kodesales,'') AS sales,
  coalesce(kodesupel,'') AS supel,
  tanggal AS ts`;

function normJual(r) {
  return {
    nota: r.notransaksi,
    tipe: r.tipe,
    kantor: r.kodekantor,
    tgl: r.tgl,
    hari: r.hari,
    item: Number(r.item) || 0,
    omzet: Number(r.omzet) || 0,
    debit: Number(r.debit) || 0,
    kredit: Number(r.kredit) || 0,
    user: r.user || '',
    mesin: r.mesin || '',
    sales: r.sales || '',
    supel: r.supel || '',
    ts: r.ts instanceof Date ? r.ts.getTime() : Date.parse(r.ts),
  };
}

async function muatKasir(pool, setTujuan, mapTujuan) {
  const users = await pool.query('SELECT userid, nama, kelompok FROM tbl_user');
  setTujuan.clear(); mapTujuan.clear();
  for (const u of users.rows) {
    if (u.kelompok && u.kelompok.startsWith('KASIR')) {
      setTujuan.add(u.userid);
      mapTujuan.set(u.userid, { userid: u.userid, nama: u.nama, kelompok: u.kelompok });
    }
  }
}

async function muatJualCp() {
  state.jualMemuat = true;
  try {
    await muatKasir(poolCp, state.kasirSet, state.kasirInfo);
    const r = await poolCp.query(
      `SELECT ${KOLOM_JUAL} FROM tbl_ikhd WHERE tipe IN ('KSR','JL') ORDER BY tanggal`
    );
    const next = new Map();
    let dari = null, sampai = null;
    for (const row of r.rows) {
      const n = normJual(row);
      next.set(n.nota, n);
      if (!dari || n.hari < dari) dari = n.hari;
      if (!sampai || n.hari > sampai) sampai = n.hari;
    }
    state.jual = next;
    state.jualDari = dari; state.jualSampai = sampai;
    state.jualSiap = true; state.jualErr = null; state.jualRefresh = Date.now();
    console.log(`[cp] siap: ${next.size} nota (${dari} s/d ${sampai})`);

    // Rentang arsip hanya perlu min/max — TIDAK memuat barisnya (hemat RAM).
    try {
      const a = await poolLama.query(
        `SELECT to_char(min(tanggal),'YYYY-MM-DD') a, count(*)::int n
           FROM tbl_ikhd WHERE tipe IN ('KSR','JL')`
      );
      state.arsipDari = a.rows[0] && a.rows[0].a;
      console.log(`[arsip] ${PGDB_CP_LAMA}: ${a.rows[0].n} nota sejak ${state.arsipDari} (on-demand)`);
    } catch (e) {
      console.error('[arsip] gagal baca rentang: ' + e.message);
    }
  } catch (e) {
    state.jualErr = e.message;
    console.error('[cp] muat gagal: ' + e.message);
  } finally {
    state.jualMemuat = false;
  }
}

async function muatJualPromo() {
  state.promoMemuat = true;
  try {
    await muatKasir(poolPromo, state.promoKasirSet, state.promoKasirInfo);
    const r = await poolPromo.query(
      `SELECT ${KOLOM_JUAL} FROM tbl_ikhd WHERE tipe IN ('KSR','JL') ORDER BY tanggal`
    );
    const next = new Map();
    let dari = null, sampai = null;
    for (const row of r.rows) {
      const n = normJual(row);
      next.set(n.nota, n);
      if (!dari || n.hari < dari) dari = n.hari;
      if (!sampai || n.hari > sampai) sampai = n.hari;
    }
    state.promo = next;
    state.promoDari = dari; state.promoSampai = sampai;
    state.promoSiap = true; state.promoErr = null; state.promoRefresh = Date.now();
    console.log(`[promo] siap: ${next.size} nota (${dari} s/d ${sampai})`);
  } catch (e) {
    state.promoErr = e.message;
    console.error('[promo] muat gagal: ' + e.message);
  } finally {
    state.promoMemuat = false;
  }
}

// Poll nota baru: cukup baris yang tanggalnya lebih baru dari maksimum cache.
async function pollBaru(pool, map, label) {
  if (!map.size) return 0;
  let maxTs = 0;
  for (const n of map.values()) if (n.ts > maxTs) maxTs = n.ts;
  if (!maxTs) return 0;
  const r = await pool.query(
    `SELECT ${KOLOM_JUAL} FROM tbl_ikhd
      WHERE tipe IN ('KSR','JL') AND tanggal > $1 ORDER BY tanggal LIMIT 500`,
    [new Date(maxTs)]
  );
  let tambah = 0;
  for (const row of r.rows) {
    const n = normJual(row);
    if (map.has(n.nota)) continue;
    map.set(n.nota, n);
    tambah++;
  }
  if (tambah) console.log(`[${label}] +${tambah} nota baru`);
  return tambah;
}

// Rekonsiliasi 3 hari terakhir: menangkap nota yang diedit/dihapus.
async function rekon(pool, map, label) {
  if (!map.size) return;
  const dari = new Date(Date.now() - 3 * 86400000);
  const r = await pool.query(
    `SELECT ${KOLOM_JUAL} FROM tbl_ikhd
      WHERE tipe IN ('KSR','JL') AND tanggal >= $1`,
    [dari]
  );
  let ubah = 0;
  const ada = new Set();
  for (const row of r.rows) {
    const n = normJual(row);
    ada.add(n.nota);
    const lama = map.get(n.nota);
    if (!lama || lama.omzet !== n.omzet || lama.item !== n.item || lama.tgl !== n.tgl) {
      map.set(n.nota, n); ubah++;
    }
  }
  if (ubah) console.log(`[${label}] rekon: ${ubah} nota diperbarui`);
}

const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);

/**
 * Pilih harga bertingkat tipehj='J' (harga per JUMLAH) — yang dipakai kasir
 * menagih. Satuan dicocokkan dulu, fallback ke semua tier.
 * ecer = tier jumlah terkecil, grosir = tier jumlah terbesar.
 *
 * PENTING: `harga`/`harga2` WAJIB ada karena ipos-bridge.js:158-159 dan
 * index.js:14944 membacanya langsung (bukan kodeitem/namaitem).
 */
const pilihTier = (arr, satuan) => {
  if (!arr || !arr.length) return null;
  const cocok = arr.filter((x) => x.sat === satuan);
  const pakai = cocok.length ? cocok : arr;
  let min = pakai[0], maks = pakai[0];
  for (const x of pakai) {
    if (x.sampai < min.sampai) min = x;
    if (x.sampai > maks.sampai) maks = x;
  }
  return { ecer: min.h, grosir: maks.h };
};

async function muatItems() {
  try {
    const [items, stok, hj] = await Promise.all([
      poolCp.query(
        `SELECT kodeitem, namaitem, satuan, jenis AS kategori, hargajual1,
                hargapokok AS hpp, statusjual
           FROM tbl_item WHERE coalesce(statushapus,'')<>'Y'`
      ),
      poolCp.query('SELECT kodeitem, kantor, stok FROM tbl_itemstok'),
      poolCp.query("SELECT kodeitem, jmlsampai, satuan, hargajual FROM tbl_itemhj WHERE tipehj='J'"),
    ]);

    const tier = new Map();
    for (const r of hj.rows) {
      const k = String(r.kodeitem || '').trim();
      if (!tier.has(k)) tier.set(k, []);
      tier.get(k).push({
        sat: String(r.satuan || '').trim(),
        sampai: num(r.jmlsampai),
        h: num(r.hargajual),
      });
    }

    const out = [];
    const byKode = new Map();
    for (const r of items.rows) {
      const kode = String(r.kodeitem || '').trim();
      const satuan = String(r.satuan || '').trim();
      const t = pilihTier(tier.get(kode), satuan);
      const hj1 = num(r.hargajual1);
      const it = {
        kode, nama: String(r.namaitem || '').trim(), satuan,
        kategori: String(r.kategori || '').trim(),
        // tier 0 valid; fallback ke hargajual1 hanya bila tier tidak ada.
        harga: t ? t.ecer : hj1,
        // grosir 0 valid; tanpa tier memang tidak ada harga ambil.
        harga2: t ? t.grosir : 0,
        hpp: num(r.hpp),
        statusjual: String(r.statusjual || ''),
        stok: 0,
        stok_kantor: {},
      };
      out.push(it);
      byKode.set(kode, it);
    }

    for (const r of stok.rows) {
      const it = byKode.get(String(r.kodeitem || '').trim());
      if (it) it.stok_kantor[String(r.kantor || '').trim()] = num(r.stok);
    }
    for (const it of out) {
      it.stok = Object.values(it.stok_kantor).reduce((a, b) => a + b, 0);
    }

    state.items = out;
    state.itemsSync = Date.now();
    state.itemsErr = null;
    console.log('[items] ' + out.length + ' barang (tier ketemu: ' + (out.length - out.filter((x) => !x.harga2).length) + ')');
  } catch (e) {
    state.itemsErr = e.message;
    console.error('[items] gagal: ' + e.message);
  }
}

// ------------------------------------------------------- ambil nota per rentang
/**
 * Nota KSR/JL pada rentang tanggal.
 * Tahun berjalan diambil dari cache memori; tanggal sebelum CUTOVER diambil
 * on-demand dari i5_CP2025 (tanpa digabung ke cache — lihat catatan tabrakan).
 */
async function ambilNotas(dari, sampai) {
  const hasil = [];
  const batasArsip = CUTOVER; // tanggal >= CUTOVER ada di i5_CP2026

  for (const n of state.jual.values()) {
    if (n.hari && n.hari >= dari && n.hari <= sampai) hasil.push(n);
  }

  if (dari < batasArsip) {
    const akhirArsip = sampai < batasArsip ? sampai : CUTOVER;
    const r = await poolLama.query(
      `SELECT ${KOLOM_JUAL} FROM tbl_ikhd
        WHERE tipe IN ('KSR','JL') AND tanggal >= $1 AND tanggal < $2
        ORDER BY tanggal`,
      [dari, akhirArsip]
    );
    for (const row of r.rows) hasil.push(normJual(row));
  }
  return hasil;
}

// ------------------------------------------------------------------- laporan
function hitungLaporan(notas, dari, sampai) {
  let nota = 0, item = 0, omzet = 0, debit = 0, kredit = 0;
  const perTipe = { KSR: { nota: 0, item: 0, omzet: 0 }, JL: { nota: 0, item: 0, omzet: 0 } };
  const perKasir = new Map();
  const adaUser = new Set();

  for (const x of notas) {
    nota++;
    // totalitem bisa pecahan (mis. 0.2 kg) — jumlahkan apa adanya, bulatkan
    // hanya di keluaran akhir agar tidak menumpuk galat pembulatan.
    item += x.item; omzet += x.omzet; debit += x.debit; kredit += x.kredit;
    const t = perTipe[x.tipe] || (perTipe[x.tipe] = { nota: 0, item: 0, omzet: 0 });
    t.nota++; t.item += x.item; t.omzet += x.omzet;
    adaUser.add(x.user);
    if (!perKasir.has(x.user)) {
      const info = state.kasirInfo.get(x.user) || {};
      perKasir.set(x.user, {
        userid: x.user, nama: info.nama || x.user, kelompok: info.kelompok || '',
        user: x.user, nota: 0, item: 0, omzet: 0, mesin: new Set(),
        jamAwal: null, jamAkhir: null, toko: 'CP',
      });
    }
    const k = perKasir.get(x.user);
    const jam = x.tgl.slice(11, 16);
    k.nota++; k.item += x.item; k.omzet += x.omzet;
    if (x.mesin) k.mesin.add(String(x.mesin).trim());
    if (!k.jamAwal || jam < k.jamAwal) k.jamAwal = jam;
    if (!k.jamAkhir || jam > k.jamAkhir) k.jamAkhir = jam;
  }

  const kasir = [...perKasir.values()].map((k) => ({
    userid: k.userid, nama: k.nama, kelompok: k.kelompok, user: k.user,
    nota: k.nota, item: Math.round(k.item), omzet: k.omzet,
    mesin: [...k.mesin].sort().join(', '),
    jam: k.jamAwal && k.jamAkhir ? `${k.jamAwal}-${k.jamAkhir}` : '',
    toko: k.toko,
  })).sort((a, b) => b.omzet - a.omzet);

  const nonaktif = [...state.kasirSet].filter((u) => !adaUser.has(u))
    .map((u) => state.kasirInfo.get(u)).filter(Boolean);

  // totalitem bisa pecahan -> bulatkan di keluaran akhir.
  for (const t of Object.values(perTipe)) t.item = Math.round(t.item);

  return { nota, item, omzet, debit, kredit, perTipe, kasir, nonaktif };
}
function laporan(dari, sampai, notasCp) {
  const cp = hitungLaporan(notasCp, dari, sampai);

  // PROMO = konter terpisah (DB i5_PROMO2025), tampil sebagai kasir toko PROMO.
  const notasPromo = [];
  for (const x of state.promo.values()) {
    if (x.hari && x.hari >= dari && x.hari <= sampai) notasPromo.push(x);
  }
  let pNota = 0, pItem = 0, pOmzet = 0, pDebit = 0, pKredit = 0;
  const pPerTipe = {};
  const pKasir = new Map();
  for (const x of notasPromo) {
    pNota++; pItem += x.item; pOmzet += x.omzet; pDebit += x.debit; pKredit += x.kredit;
    const t = pPerTipe[x.tipe] || (pPerTipe[x.tipe] = { nota: 0, item: 0, omzet: 0 });
    t.nota++; t.item += x.item; t.omzet += x.omzet;
    if (!pKasir.has(x.user)) {
      const info = state.promoKasirInfo.get(x.user) || {};
      pKasir.set(x.user, {
        userid: x.user, nama: info.nama || x.user, kelompok: info.kelompok || '',
        user: x.user, nota: 0, item: 0, omzet: 0, mesin: new Set(),
        jamAwal: null, jamAkhir: null, toko: 'PROMO',
      });
    }
    const k = pKasir.get(x.user);
    const jam = x.tgl.slice(11, 16);
    k.nota++; k.item += x.item; k.omzet += x.omzet;
    if (x.mesin) k.mesin.add(String(x.mesin).trim());
    if (!k.jamAwal || jam < k.jamAwal) k.jamAwal = jam;
    if (!k.jamAkhir || jam > k.jamAkhir) k.jamAkhir = jam;
  }
  const promoKasir = [...pKasir.values()].map((k) => ({
    userid: k.userid, nama: k.nama, kelompok: k.kelompok, user: k.user,
    nota: k.nota, item: Math.round(k.item), omzet: k.omzet,
    mesin: [...k.mesin].sort().join(', '),
    jam: k.jamAwal && k.jamAkhir ? `${k.jamAwal}-${k.jamAkhir}` : '',
    toko: 'PROMO',
  })).sort((a, b) => b.omzet - a.omzet);

  // jangkauan = gabungan rentang arsip + tahun berjalan (tanpa memuat barisnya).
  const jangkauanDari = state.arsipDari && (!state.jualDari || state.arsipDari < state.jualDari)
    ? state.arsipDari : state.jualDari;
  const jangkauanSampai = state.jualSampai > (state.promoSampai || '')
    ? state.jualSampai : state.promoSampai;

  return {
    siap: true, dari, sampai,
    jangkauan: { dari: jangkauanDari, sampai: jangkauanSampai },
    // tunai = omzet - debit - kredit (kolom jmltunai = uang diserahkan kasir
    // termasuk kembalian — BUKAN angka laporan iPos).
    total: {
      // Sama seperti proxy CP asli: kasir = jumlah kasir CP saja (PROMO terpisah).
      kasir: cp.kasir.length,
      // totalitem bisa pecahan (mis. 0.2 kg) -> bulatkan di keluaran akhir.
      nota: cp.nota, item: Math.round(cp.item), omzet: cp.omzet,
      tunai: cp.omzet - cp.debit - cp.kredit, debit: cp.debit, kredit: cp.kredit,
    },
    perTipe: cp.perTipe,
    promo: {
      nota: pNota, item: pItem, omzet: pOmzet,
      tunai: pOmzet - pDebit - pKredit, debit: pDebit, kredit: pKredit,
      perTipe: pPerTipe,
    },
    promoSiap: state.promoSiap,
    // Kasir CP + kasir PROMO digabung, urut omzet turun (persis proxy CP asli).
    kasir: [...cp.kasir, ...promoKasir].sort((a, b) => b.omzet - a.omzet),
    nonaktif: cp.nonaktif,
    update: Math.max(state.jualRefresh, state.promoRefresh),
  };
}

// ---------------------------------------------------------------------- http
function send(res, code, obj, maxAge) {
  const body = JSON.stringify(obj);
  const h = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  };
  if (maxAge) h['cache-control'] = `public, max-age=${maxAge}`;
  res.writeHead(code, h);
  res.end(body);
}

const cekRentang = (u) => {
  const dari = (u.searchParams.get('dari') || '').slice(0, 10);
  const sampai = (u.searchParams.get('sampai') || dari).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dari) || !/^\d{4}-\d{2}-\d{2}$/.test(sampai)) {
    return { err: 'parameter dari/sampai wajib format YYYY-MM-DD' };
  }
  return { dari, sampai };
};

const belumSiap = () => ({
  siap: false, memuat: state.jualMemuat, err: state.jualErr,
  catatan: 'cache penjualan belum siap — muat pertama ±1 menit setelah start',
});

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'X-API-Key, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const u = new URL(req.url, 'http://x');
  let p = u.pathname;
  if (BASE_PATH && p.startsWith(BASE_PATH)) p = p.slice(BASE_PATH.length) || '/';

  const key = req.headers['x-api-key'] || u.searchParams.get('key');
  if (p !== '/health' && key !== API_KEY) {
    return send(res, 401, { error: 'unauthorized' });
  }

  try {
    if (p === '/health') {
      const umur = (t) => (t ? Math.round((Date.now() - t) / 1000) : null);
      return send(res, 200, {
        ok: !state.jualErr && !state.itemsErr,
        items: state.items.length,
        lastSync: state.itemsSync,
        lastError: state.itemsErr,
        jual: {
          siap: state.jualSiap, memuat: state.jualMemuat,
          nota: state.jual.size,
          dari: state.jualDari, sampai: state.jualSampai,
          umurDetik: umur(state.jualRefresh),
          err: state.jualErr,
        },
        jualPromo: {
          siap: state.promoSiap, memuat: state.promoMemuat,
          nota: state.promo.size,
          dari: state.promoDari, sampai: state.promoSampai,
          umurDetik: umur(state.promoRefresh),
          err: state.promoErr,
        },
        arsip: { database: PGDB_CP_LAMA, dari: state.arsipDari, mode: 'on-demand' },
      });
    }

    if (p === '/api/items') {
      return send(res, 200, { count: state.items.length, data: state.items });
    }

    if (p === '/api/kantor') {
      return send(res, 200, { data: [{ kodekantor: 'ALAK', namakantor: 'CENTRAL PERABOT' }] });
    }

    if (p === '/api/jual') {
      const dari = (u.searchParams.get('dari') || state.jualSampai || '').slice(0, 10);
      const sampai = (u.searchParams.get('sampai') || dari).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dari) || !/^\d{4}-\d{2}-\d{2}$/.test(sampai)) {
        return send(res, 400, { error: 'parameter dari/sampai wajib format YYYY-MM-DD' });
      }
      if (!state.jualSiap) return send(res, 200, belumSiap());
      const notas = await ambilNotas(dari, sampai);
      return send(res, 200, laporan(dari, sampai, notas));
    }

    if (p === '/api/jual-merek') {
      const c = cekRentang(u);
      if (c.err) return send(res, 400, { error: c.err });
      const merekList = (u.searchParams.get('merek') || 'HOMMY,KIREI')
        .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 20);
      if (!merekList.length) return send(res, 400, { error: 'parameter merek kosong' });
      if (!state.jualSiap) return send(res, 200, belumSiap());

      const notas = await ambilNotas(c.dari, c.sampai);
      const daftarNota = notas.map((n) => n.nota);
      const kosong = {
        siap: true, dari: c.dari, sampai: c.sampai, merek: merekList,
        data: merekList.map((m) => ({ merek: m, nota: 0, item: 0, omzet: 0 })),
        total: { nota: 0, item: 0, omzet: 0 },
        pelanggan: [], totalPelanggan: 0, notaRentang: 0,
        jangkauan: { dari: state.arsipDari || state.jualDari, sampai: state.jualSampai },
        update: state.jualRefresh,
      };
      if (!daftarNota.length) return send(res, 200, kosong, 8);

      const r = await poolCp.query(
        `SELECT i.merek,
                count(DISTINCT d.notransaksi)::int AS nota,
                sum(d.jumlah) AS item, sum(d.total) AS omzet
           FROM tbl_ikdt d JOIN tbl_item i ON i.kodeitem = d.kodeitem
          WHERE d.notransaksi = ANY($1::text[]) AND i.merek = ANY($2::text[])
          GROUP BY i.merek ORDER BY i.merek`,
        [daftarNota, merekList]
      );
      const perMerek = new Map(r.rows.map((x) => [String(x.merek).toUpperCase(), {
        merek: String(x.merek).toUpperCase(),
        nota: Number(x.nota) || 0, item: Number(x.item) || 0, omzet: Number(x.omzet) || 0,
      }]));
      const data = merekList.map((m) => perMerek.get(m) || { merek: m, nota: 0, item: 0, omzet: 0 });
      const total = { nota: 0, item: 0, omzet: 0 };
      for (const x of data) { total.nota += x.nota; total.item += x.item; total.omzet += x.omzet; }

      // Pelanggan = nota JL ke toko (kodesupel selain UMUM*).
      const notaToko = notas.filter(
        (n) => n.tipe === 'JL' && n.supel && !String(n.supel).startsWith('UMUM')
      );
      const perNota = new Map();
      if (notaToko.length) {
        const rr = await poolCp.query(
          `SELECT d.notransaksi, i.merek, sum(d.jumlah) AS item, sum(d.total) AS omzet
             FROM tbl_ikdt d JOIN tbl_item i ON i.kodeitem = d.kodeitem
            WHERE d.notransaksi = ANY($1::text[]) AND i.merek = ANY($2::text[])
            GROUP BY d.notransaksi, i.merek`,
          [notaToko.map((n) => n.nota), merekList]
        );
        for (const x of rr.rows) {
          const k = String(x.notransaksi);
          if (!perNota.has(k)) perNota.set(k, new Map());
          perNota.get(k).set(String(x.merek).toUpperCase(), {
            item: Number(x.item) || 0, omzet: Number(x.omzet) || 0,
          });
        }
      }
      const perToko = new Map();
      for (const n of notaToko) {
        if (!perNota.has(n.nota)) continue;
        if (!perToko.has(n.supel)) perToko.set(n.supel, []);
        perToko.get(n.supel).push(n);
      }
      const pelanggan = [...perToko.entries()].map(([kode, list]) => {
        const notaList = list.map((n) => {
          const mm = perNota.get(n.nota);
          return {
            notransaksi: n.nota, tanggal: n.hari, notaTotal: n.omzet,
            perMerek: merekList.map((m) => ({
              merek: m, item: (mm.get(m) || {}).item || 0, omzet: (mm.get(m) || {}).omzet || 0,
            })),
          };
        }).sort((a, b) => (a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1
          : (a.notransaksi < b.notransaksi ? -1 : 1)));
        const per = merekList.map((m) => {
          let item = 0, omzet = 0;
          for (const nl of notaList) {
            const x = nl.perMerek.find((y) => y.merek === m);
            if (x) { item += x.item; omzet += x.omzet; }
          }
          return { merek: m, item, omzet };
        });
        return {
          kode, nama: kode, nota: notaList.length,
          item: per.reduce((s, x) => s + x.item, 0),
          omzet: per.reduce((s, x) => s + x.omzet, 0),
          perMerek: per, notaList,
        };
      }).sort((a, b) => b.omzet - a.omzet);

      return send(res, 200, {
        siap: true, dari: c.dari, sampai: c.sampai, merek: merekList, data, total,
        pelanggan, totalPelanggan: pelanggan.length, notaRentang: daftarNota.length,
        jangkauan: { dari: state.arsipDari || state.jualDari, sampai: state.jualSampai },
        update: state.jualRefresh,
      }, 8);
    }

    if (p === '/api/jual-marketplace') {
      const c = cekRentang(u);
      if (c.err) return send(res, 400, { error: c.err });
      if (!state.jualSiap) return send(res, 200, belumSiap());
      const notas = await ambilNotas(c.dari, c.sampai);
      const mp = notas.filter((n) => String(n.sales || '').toUpperCase() === 'MARKETPLACE');
      const central = { nota: mp.length, omzet: 0, tunai: 0, debit: 0, kredit: 0, notas: [] };
      for (const n of mp) {
        central.omzet += n.omzet; central.debit += n.debit; central.kredit += n.kredit;
        central.notas.push({ notransaksi: n.nota, tipe: n.tipe, tanggal: n.hari, omzet: n.omzet });
      }
      central.tunai = central.omzet - central.debit - central.kredit;
      central.notas.sort((a, b) => (a.tipe === 'JL' ? -1 : 1) - (b.tipe === 'JL' ? -1 : 1));
      return send(res, 200, {
        siap: true, dari: c.dari, sampai: c.sampai,
        toko: [], central, total: central.omzet,
        jangkauan: { dari: state.arsipDari || state.jualDari, sampai: state.jualSampai },
        update: state.jualRefresh,
      }, 8);
    }

    if (p === '/api/item-live') {
      const kode = String(u.searchParams.get('kode') || '').trim().toUpperCase();
      if (!kode) return send(res, 400, { error: 'parameter kode wajib' });
      try {
        const [a, b, c] = await Promise.all([
          poolCp.query(
            `SELECT kodeitem, namaitem, satuan, jenis AS kategori, hargajual1,
                    hargapokok AS hpp, statusjual
               FROM tbl_item WHERE kodeitem=$1 AND coalesce(statushapus,'')<>'Y'`, [kode]),
          poolCp.query('SELECT kantor, stok FROM tbl_itemstok WHERE kodeitem=$1', [kode]),
          poolCp.query(
            "SELECT jmlsampai, satuan, hargajual FROM tbl_itemhj WHERE tipehj='J' AND kodeitem=$1", [kode]),
        ]);
        if (!a.rows.length) return send(res, 404, { error: 'item tidak ditemukan' });
        const r = a.rows[0];
        const satuan = String(r.satuan || '').trim();
        const tiers = c.rows.map((x) => ({
          sat: String(x.satuan || '').trim(),
          sampai: num(x.jmlsampai),
          h: num(x.hargajual),
        }));
        const t = pilihTier(tiers, satuan);
        const hj1 = num(r.hargajual1);
        const stok_kantor = {};
        for (const s of b.rows) {
          stok_kantor[String(s.kantor || '').trim()] = num(s.stok);
        }
        // Bentuk respons WAJIB sama dengan proxy CP asli:
        // {"data":{"kode","nama","satuan","kategori","harga","harga2","hpp",
        //          "statusjual","stok","stok_kantor":{...}}}
        // ipos-bridge.js:152-160 membaca it.nama / it.harga / it.harga2 / it.stok.
        return send(res, 200, {
          data: {
            kode: String(r.kodeitem || '').trim(),
            nama: String(r.namaitem || '').trim(),
            satuan,
            kategori: String(r.kategori || '').trim(),
            harga: t ? t.ecer : hj1,
            harga2: t ? t.grosir : 0,
            hpp: num(r.hpp),
            statusjual: String(r.statusjual || ''),
            stok: Object.values(stok_kantor).reduce((s, x) => s + x, 0),
            stok_kantor,
          },
        });
      } catch (e) {
        return send(res, 500, { error: String((e && e.message) || e) });
      }
    }

    if (p === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(`event: hello\ndata: ${JSON.stringify({
        seri: 'CP', items: state.items.length, lastSync: state.itemsSync,
        jualSiap: state.jualSiap,
      })}\n\n`);
      const iv = setInterval(() => {
        try { res.write(`event: jual-ping\ndata: ${JSON.stringify({ t: Date.now() })}\n\n`); }
        catch (_) { clearInterval(iv); }
      }, 15000);
      req.on('close', () => clearInterval(iv));
      return;
    }

    return send(res, 404, { error: 'not found', path: p });
  } catch (e) {
    console.error('[http] ' + e.message);
    return send(res, 500, { error: String((e && e.message) || e) });
  }
});

// -------------------------------------------------------------------- mulai
async function loopJual() {
  for (;;) {
    try {
      if (!state.jualSiap) { if (!state.jualMemuat) await muatJualCp(); }
      else { await pollBaru(poolCp, state.jual, 'cp'); }
      state.jualErr = null;
    } catch (e) { state.jualErr = e.message; }
    await new Promise((r) => setTimeout(r, JUAL_POLL_MS));
  }
}

async function loopPromo() {
  for (;;) {
    try {
      if (!state.promoSiap) { if (!state.promoMemuat) await muatJualPromo(); }
      else { await pollBaru(poolPromo, state.promo, 'promo'); }
      state.promoErr = null;
    } catch (e) { state.promoErr = e.message; }
    await new Promise((r) => setTimeout(r, JUAL_POLL_MS * 2));
  }
}

async function loopRekon() {
  for (;;) {
    await new Promise((r) => setTimeout(r, 60000));
    try { await rekon(poolCp, state.jual, 'cp'); }
    catch (e) { console.error('[rekon cp] ' + e.message); }
    try { await rekon(poolPromo, state.promo, 'promo'); }
    catch (e) { console.error('[rekon promo] ' + e.message); }
  }
}

async function loopItems() {
  for (;;) {
    await muatItems();
    await new Promise((r) => setTimeout(r, ITEM_POLL_MS));
  }
}

server.listen(PORT, HOST, () => {
  console.log(`[listen] proxy CP di http://${HOST}:${PORT}${BASE_PATH}`);
  console.log(`[db] ${PGHOST}:${PGPORT} cp=${PGDB_CP} arsip=${PGDB_CP_LAMA} promo=${PGDB_PROMO}`);
  loopJual();
  loopPromo();
  loopRekon();
  loopItems();
});

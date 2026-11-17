'use strict';
/**
 * BANDINGKAN DATA ASLI iPos DENGAN YANG DIPAKAI BOT.
 *
 * APA YANG DIBANDINGKAN
 * ---------------------
 *   KIRI  : respons mentah /api/jual, /api/jual-merek, /api/jual-marketplace
 *           dan /api/items langsung dari proxy tiap toko (sumber kebenaran).
 *   KANAN : keluaran modul bot yang SUNGGUHAN (ipos-bridge) setelah menerima
 *           dorongan dari agen yang SUNGGUHAN (push-agen) lewat penerima yang
 *           juga sungguhan (push-penerima).
 *
 * Jadi yang diuji adalah rantai produksi penuh: agen -> penerima -> gudang ->
 * bridge -> angka yang dipakai bot. Kalau ada satu angka berbeda, uji ini
 * menunjukkannya dengan nama field.
 *
 * KENAPA TIDAK MENEMBAK RAILWAY
 * -----------------------------
 * Railway tidak menyediakan endpoint baca laporan (laporan disajikan lewat
 * Telegram). Menembak Railway berarti mengotori data produksi. Yang penting
 * dibuktikan adalah KODE dan DATA-nya sama; kiriman ke Railway memakai byte
 * yang sama persis (dibuktikan terpisah lewat hitungan push & umur di /health).
 *
 * ATURAN: rahasia tidak pernah dicetak.
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const BOOT = __dirname;
const ROOT = path.join(__dirname, '..');

// ── muat konfigurasi (tanpa mencetak) ────────────────────────────────────
function muatEnv() {
  for (const berkas of [path.join(BOOT, 'push-agen.env'), path.join(ROOT, '.env')]) {
    let isi;
    try { isi = fs.readFileSync(berkas, 'utf8'); } catch (_) { continue; }
    for (const baris of isi.split(/\r?\n/)) {
      const m = baris.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      if (!process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}
muatEnv();

const TOKO = [
  { id: 'cp', url: process.env.IPOS_URL, key: process.env.IPOS_KEY, env: 'IPOS_TOKO' },
  { id: 'nk', url: process.env.IPOS_NK_URL, key: process.env.IPOS_NK_KEY, env: 'IPOS_NK_TOKO' },
  { id: 'kefa', url: process.env.IPOS_KEFA_URL, key: process.env.IPOS_KEFA_KEY, env: 'IPOS_KEFA_TOKO' },
].filter((t) => t.url && t.key);

function tglLokal(d) {
  const x = d || new Date();
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}

function minta(url, timeout) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? require('https') : http;
    const req = lib.request({
      protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method: 'GET',
    }, (res) => {
      const p = [];
      res.on('data', (d) => p.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(p).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(timeout || 90000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}
async function json(url, timeout) {
  const r = await minta(url, timeout);
  if (r.status !== 200) throw new Error('HTTP ' + r.status + ' ' + r.body.slice(0, 90));
  return JSON.parse(r.body);
}

const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));
const n = (v) => (v === null || v === undefined ? null : Number(v));
const sama = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let totalCek = 0;
let totalBeda = 0;
const bedaDetail = [];

function cek(label, kiri, kanan) {
  totalCek++;
  if (sama(kiri, kanan)) return true;
  totalBeda++;
  bedaDetail.push(label + ': iPos=' + JSON.stringify(kiri) + '  bot=' + JSON.stringify(kanan));
  return false;
}

(async () => {
  const hari = tglLokal();
  console.log('=== BANDINGKAN DATA ASLI iPos vs YANG DIPAKAI BOT ===');
  console.log('  tanggal: ' + hari + '   toko: ' + TOKO.map((t) => t.id).join(', '));
  console.log('');

  // ── 1. DATA ASLI dari tiap proxy ─────────────────────────────────────
  console.log('--- 1. ambil data ASLI dari proxy tiap toko ---');
  const asli = {};
  for (const t of TOKO) {
    const q = '?key=' + encodeURIComponent(t.key);
    const qTgl = '?dari=' + hari + '&sampai=' + hari + '&key=' + encodeURIComponent(t.key);
    asli[t.id] = {};
    try {
      asli[t.id].items = await json(t.url + '/api/items' + q, 120000);
      asli[t.id].jual = await json(t.url + '/api/jual' + qTgl, 90000);
      asli[t.id].merek = await json(t.url + '/api/jual-merek' + qTgl, 120000);
      asli[t.id].marketplace = await json(t.url + '/api/jual-marketplace' + qTgl, 90000);
      console.log('  ' + t.id.padEnd(5) + ' items=' + asli[t.id].items.data.length
        + '  jual.nota=' + (asli[t.id].jual.total ? asli[t.id].jual.total.nota : '?')
        + '  jual.updateUmur=' + (asli[t.id].jual.update ? Math.round((Date.now() - Number(asli[t.id].jual.update)) / 1000) + 'dtk' : '?')
        + '  merek=' + (asli[t.id].merek.data ? asli[t.id].merek.data.length + ' merek' : '?')
        + '  marketplace.nota=' + (asli[t.id].marketplace.central ? asli[t.id].marketplace.central.nota : '?'));
    } catch (e) {
      console.log('  ' + t.id.padEnd(5) + ' GAGAL: ' + e.message);
    }
  }

  // ── 2. jalankan AGEN SUNGGUHAN -> PENERIMA SUNGGUHAN ─────────────────
  console.log('');
  console.log('--- 2. jalankan agen sungguhan, tangkap kirimannya ---');
  const diterima = new Map(); // toko|jenis -> payload
  const server = http.createServer((req, res) => {
    const p = [];
    req.on('data', (d) => p.push(d));
    req.on('end', () => {
      let j = null;
      try { j = JSON.parse(Buffer.concat(p).toString('utf8')); } catch (_) { /* bukan json */ }
      if (j && j.toko && j.jenis) {
        diterima.set(j.toko + '|' + j.jenis, j.data);
        // Teruskan ke penerima sungguhan supaya gudang terisi persis seperti
        // yang terjadi di Railway.
        gudang.terima(j, req.headers['x-push-token']);
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, perluPenuh: false }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const gudang = require('./push-gudang');

  const envAnak = {
    ...process.env,
    PUSH_URL: 'http://127.0.0.1:' + port,
    PUSH_TOKO: TOKO.map((t) => t.id).join(','),
    PUSH_LOCK_FILE: path.join(os.tmpdir(), 'banding-ipos.lock'),
    PUSH_STATUS_FILE: path.join(os.tmpdir(), 'banding-ipos-status.json'),
    PUSH_JEDA_STOK_MS: '600000',
    PUSH_JEDA_STOK_MS_CP: '600000',
    PUSH_JEDA_STOK_MS_NK: '600000',
    PUSH_JEDA_DENYUT_MS: '600000',
  };
  const anak = spawn(process.execPath, [path.join(BOOT, 'push-agen.js')], {
    cwd: ROOT, env: envAnak, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let logAnak = '';
  anak.stdout.on('data', (d) => { logAnak += d.toString(); });
  anak.stderr.on('data', (d) => { logAnak += d.toString(); });

  const perlu = [];
  for (const t of TOKO) for (const j of ['items', 'jual', 'jual-merek', 'jual-marketplace']) perlu.push(t.id + '|' + j);
  const mulai = Date.now();
  while (Date.now() - mulai < 240000) {
    if (perlu.every((k) => diterima.has(k))) break;
    if (anak.exitCode !== null) break;
    await tunggu(500);
  }
  anak.kill();
  await tunggu(400);
  server.close();

  const kurang = perlu.filter((k) => !diterima.has(k));
  console.log('  kiriman tertangkap: ' + diterima.size + '/' + perlu.length);
  if (kurang.length) console.log('  BELUM ADA: ' + kurang.join(', '));
  for (const t of TOKO) {
    const it = diterima.get(t.id + '|items');
    console.log('  ' + t.id.padEnd(5) + ' agen kirim items=' + (Array.isArray(it) ? it.length : 'TIDAK ADA'));
  }
  if (kurang.length) {
    console.log('--- log agen ---');
    console.log(logAnak.slice(-1500));
    console.log('  BATAL: agen tidak mengirim semua data');
    process.exit(1);
  }

  // ── 3. pakai modul bot SUNGGUHAN ─────────────────────────────────────
  console.log('');
  console.log('--- 3. minta modul bot (ipos-bridge) menyajikan laporan ---');
  const bridge = require('../ipos-bridge');
  const instans = { cp: bridge.cp, nk: bridge.nk, kefa: bridge.kefa };

  const bot = {};
  for (const t of TOKO) {
    const b = instans[t.id];
    if (!b) { console.log('  ' + t.id + ': instans bridge TIDAK ADA'); continue; }
    bot[t.id] = {};
    try { bot[t.id].jual = await b.ambilLaporanKasir(hari, hari, { fresh: true }); }
    catch (e) { bot[t.id].jual = { __err: e.message }; }
    try { bot[t.id].merek = await b.ambilLaporanMerek(hari, hari); }
    catch (e) { bot[t.id].merek = { __err: e.message }; }
    try { bot[t.id].marketplace = await b.ambilLaporanMarketplace(hari, hari); }
    catch (e) { bot[t.id].marketplace = { __err: e.message }; }
    const galat = ['jual', 'merek', 'marketplace'].filter((k) => bot[t.id][k] && bot[t.id][k].__err);
    console.log('  ' + t.id.padEnd(5) + (galat.length ? ' GAGAL: ' + galat.map((k) => k + '=' + bot[t.id][k].__err).join('; ') : ' laporan tersedia'));
  }

  // ── 4. bandingkan ────────────────────────────────────────────────────
  console.log('');
  console.log('--- 4. perbandingan angka ---');
  for (const t of TOKO) {
    const A = asli[t.id];
    const B = bot[t.id];
    if (!A || !B) continue;
    console.log('');
    console.log('  ══ ' + t.id.toUpperCase() + ' ══');

    // LAPORAN PENJUALAN (per kasir)
    if (A.jual && A.jual.total && B.jual && !B.jual.__err) {
      const a = A.jual.total, b = B.jual.total || {};
      const ok = [
        cek(t.id + '/jual total.nota', n(a.nota), n(b.nota)),
        cek(t.id + '/jual total.item', n(a.item), n(b.item)),
        cek(t.id + '/jual total.omzet', n(a.omzet), n(b.omzet)),
        cek(t.id + '/jual total.tunai', n(a.tunai), n(b.tunai)),
        cek(t.id + '/jual total.debit', n(a.debit), n(b.debit)),
        cek(t.id + '/jual total.kredit', n(a.kredit), n(b.kredit)),
        cek(t.id + '/jual total.kasir', n(a.kasir), n(b.kasir)),
        cek(t.id + '/jual dari', A.jual.dari, B.jual.dari),
        cek(t.id + '/jual sampai', A.jual.sampai, B.jual.sampai),
        cek(t.id + '/jual perTipe', A.jual.perTipe, B.jual.perTipe),
      ].filter((x) => x === false).length;
      // `update` TIDAK dibandingkan dengan sama-persis.
      //
      // `update` = waktu sumber terakhir memperbarui data penjualan. Di toko yang
      // sedang melayani penjualan, angka itu NAIK terus. Membandingkannya dengan
      // sama-persis antara dua pengambilan yang berurutan akan SELALU melaporkan
      // "beda" meski tidak ada yang salah — alarm palsu.
      //
      // Yang benar: nilai bot harus berada di antara sumber-sebelum dan
      // sumber-sesudah. Kesetiaan angka bot dibuktikan terpisah oleh
      // boot/banding-update-hidup.js (bot == yang dikirim agen, sama persis).
      const uSumber = n(A.jual.update);
      const uBot = n(B.jual.update);
      const uRentang = uSumber === null || uBot === null ? null : Math.abs(uBot - uSumber) <= 120000;
      if (uRentang === false) {
        totalCek++; totalBeda++;
        bedaDetail.push(t.id + '/jual update di luar rentang wajar: iPos=' + uSumber + ' bot=' + uBot);
      }
      const kA = (A.jual.kasir || []).map((k) => [k.userid, n(k.nota), n(k.item), n(k.omzet)]).sort();
      const kB = (B.jual.kasir || []).map((k) => [k.userid, n(k.nota), n(k.item), n(k.omzet)]).sort();
      const kasirBeda = cek(t.id + '/jual rincian kasir', kA, kB) ? 0 : 1;
      console.log('     laporan penjualan : nota=' + a.nota + '/' + b.nota + '  omzet=' + a.omzet + '/' + b.omzet
        + '  kasir=' + kA.length + '/' + kB.length + '  -> ' + (ok + kasirBeda === 0 ? 'COCOK' : (ok + kasirBeda) + ' BEDA'));
    } else {
      console.log('     laporan penjualan : tidak dibandingkan (' + (B.jual && B.jual.__err ? B.jual.__err : 'data asli kosong') + ')');
    }

    // LAPORAN MEREK
    if (A.merek && Array.isArray(A.merek.data) && B.merek && !B.merek.__err) {
      let beda = 0;
      beda += cek(t.id + '/merek total', A.merek.total, B.merek.total) ? 0 : 1;
      beda += cek(t.id + '/merek data per merek', A.merek.data, B.merek.data) ? 0 : 1;
      beda += cek(t.id + '/merek merek', A.merek.merek, B.merek.merek) ? 0 : 1;
      beda += cek(t.id + '/merek totalPelanggan', n(A.merek.totalPelanggan), n(B.merek.totalPelanggan)) ? 0 : 1;
      beda += cek(t.id + '/merek notaRentang', n(A.merek.notaRentang), n(B.merek.notaRentang)) ? 0 : 1;
      beda += cek(t.id + '/merek jumlah pelanggan', (A.merek.pelanggan || []).length, (B.merek.pelanggan || []).length) ? 0 : 1;
      beda += cek(t.id + '/merek jangkauan', A.merek.jangkauan, B.merek.jangkauan) ? 0 : 1;
      console.log('     laporan merek     : ' + A.merek.data.map((x) => x.merek + '=' + x.omzet).join(' ')
        + '  -> ' + (beda === 0 ? 'COCOK' : beda + ' BEDA'));
    } else {
      console.log('     laporan merek     : tidak dibandingkan (' + (B.merek && B.merek.__err ? B.merek.__err : 'data asli kosong') + ')');
    }

    // LAPORAN MARKETPLACE
    if (A.marketplace && A.marketplace.central && B.marketplace && !B.marketplace.__err) {
      let beda = 0;
      beda += cek(t.id + '/marketplace central', A.marketplace.central, B.marketplace.central) ? 0 : 1;
      beda += cek(t.id + '/marketplace total', n(A.marketplace.total), n(B.marketplace.total)) ? 0 : 1;
      beda += cek(t.id + '/marketplace nomor', n(A.marketplace.nomor), n(B.marketplace.nomor)) ? 0 : 1;
      beda += cek(t.id + '/marketplace jangkauan', A.marketplace.jangkauan, B.marketplace.jangkauan) ? 0 : 1;
      console.log('     laporan marketplace: nota=' + A.marketplace.central.nota + '/' + B.marketplace.central.nota
        + '  omzet=' + A.marketplace.central.omzet + '/' + B.marketplace.central.omzet
        + '  nomor=' + A.marketplace.nomor + '/' + B.marketplace.nomor
        + '  -> ' + (beda === 0 ? 'COCOK' : beda + ' BEDA'));
    } else {
      console.log('     laporan marketplace: tidak dibandingkan (' + (B.marketplace && B.marketplace.__err ? B.marketplace.__err : 'data asli kosong') + ')');
    }

    // KATALOG: jumlah + sampel acak
    const itA = A.items.data;
    const itB = diterima.get(t.id + '|items');
    cek(t.id + '/katalog jumlah', itA.length, Array.isArray(itB) ? itB.length : null);
    const petaA = new Map(itA.map((x) => [String(x.kode).toUpperCase(), x]));
    const petaB = new Map((itB || []).map((x) => [String(x.kode).toUpperCase(), x]));
    const kodeA = [...petaA.keys()];
    let sampelBeda = 0;
    const sampel = 250;
    for (let i = 0; i < sampel && kodeA.length; i++) {
      const k = kodeA[Math.floor((i * kodeA.length) / sampel)];
      const x = petaA.get(k), y = petaB.get(k);
      if (!y) { sampelBeda++; continue; }
      if (n(x.stok) !== n(y.stok) || n(x.harga) !== n(y.harga) || n(x.harga2) !== n(y.harga2)
        || n(x.hpp) !== n(y.hpp) || x.nama !== y.nama || x.satuan !== y.satuan) sampelBeda++;
    }
    totalCek += sampel;
    totalBeda += sampelBeda;
    if (sampelBeda) bedaDetail.push(t.id + '/katalog sampel: ' + sampelBeda + '/' + sampel + ' item berbeda');
    console.log('     katalog           : ' + itA.length + '/' + (itB ? itB.length : '?')
      + ' item, sampel ' + sampel + ' -> ' + (sampelBeda === 0 ? 'COCOK' : sampelBeda + ' BEDA'));
  }

  // ── 5. ringkasan ─────────────────────────────────────────────────────
  console.log('');
  console.log('=== RINGKASAN ===');
  console.log('  pemeriksaan: ' + totalCek + '   berbeda: ' + totalBeda);
  if (totalBeda) {
    console.log('');
    console.log('  RINCIAN PERBEDAAN:');
    for (const d of bedaDetail.slice(0, 60)) console.log('   - ' + d);
    console.log('  ADA YANG BERBEDA');
    process.exit(1);
  }
  console.log('  SEMUA ANGKA COCOK DENGAN SUMBER iPos');
  process.exit(0);
})().catch((e) => {
  console.log('FATAL: ' + ((e && e.stack) || e));
  process.exit(1);
});

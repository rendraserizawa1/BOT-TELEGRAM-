'use strict';
/**
 * AGEN PENDORONG iPos — berjalan di PC, mendorong data ke Railway.
 *
 * KENAPA ARAHNYA DIBALIK
 * ----------------------
 * Arah "tarik" (Railway menghubungi iPos di PC) sudah dicoba dua kali:
 *   - Cloudflare quick tunnel : hostname mati (ENOTFOUND), dan menahan body SSE
 *                               (HTTP 200, 0 byte selama 150 dtk)
 *   - Tailscale userspace     : bisa, tetapi node Railway tidak punya jalur
 *                               langsung ke PC (CGNAT) sehingga semua trafik
 *                               lewat DERP relay -> SOCKS5 connection timeout
 *                               intermiten, koneksi naik-turun
 * Keduanya gagal karena satu sebab yang sama: PC TIDAK BISA DIJANGKAU DARI LUAR.
 *
 * Arah "dorong" tidak punya masalah itu. Terukur: PC -> Railway 780 KB dalam
 * 0,81 detik lewat HTTPS publik biasa. Dan yang lebih penting: TIDAK ADA
 * SAMBUNGAN YANG HARUS DIJAGA. Kalau satu kiriman gagal, kiriman berikutnya
 * menyusul. Inilah arti "tidak pernah putus" yang bisa dijamin.
 *
 * CARA KERJA
 * ----------
 * 1. Ambil katalog penuh dari proxy lokal -> dorong sebagai `items` (sekali).
 * 2. Berlangganan SSE proxy lokal -> setiap frame `items` didorong sebagai
 *    `items-ubah` (delta). Biasanya 1-5 baris, bukan 780 KB.
 * 3. Setiap frame `jual` -> tarik laporan hari ini -> dorong sebagai `jual`.
 * 4. Katalog penuh diulang tiap JEDA_PENUH untuk mengoreksi delta yang hilang.
 * 5. Setiap kegagalan dicatat dan dicoba lagi. Tidak pernah berhenti.
 *
 * PEMAKAIAN
 * ---------
 *   set PUSH_URL=https://kefa-bot-production.up.railway.app
 *   set PUSH_TOKEN=<rahasia>
 *   node boot\push-agen.js
 *
 * Opsional:
 *   PUSH_TOKO=cp,nk,kefa     (default: semua toko yang IPOS_*_URL-nya ada)
 *   PUSH_JEDA_PENUH_MS=900000 (katalog penuh tiap 15 menit)
 *   PUSH_JEDA_STOK_MS / _CP / _NK  (jeda pemantau stok per toko)
 *   PUSH_JEDA_LAPORAN_MS / _CP / _NK
 *   PUSH_JEDA_MEREK_MS / _CP / _NK, PUSH_JEDA_MARKETPLACE_MS / _CP / _NK
 *
 * SUMBER YANG DIIZINKAN
 * ---------------------
 * Hanya loopback (127.0.0.1) dan tailnet (100.64.0.0/10). Tunnel publik
 * ditolak — alamat itu untuk bot di Railway, bukan untuk agen di PC ini.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const STATUS = process.env.PUSH_STATUS_FILE || path.join(__dirname, 'push-status.json');
// Kunci bisa diarahkan lewat env supaya uji tidak berebut kunci dengan agen
// produksi yang sedang berjalan. Default tetap sama -> perilaku PC tidak berubah.
const LOCK = process.env.PUSH_LOCK_FILE || path.join(__dirname, '.push-agen.lock');

/**
 * MUAT KONFIGURASI SENDIRI (jangan bergantung pada wrapper).
 *
 * KENAPA INI PENTING — BUKAN KERAPIAN
 * -----------------------------------
 * Dulu `boot/push-agen.env` HANYA dibaca oleh `jaga-push.ps1`. Kalau agen
 * dijalankan dengan cara lain (uji, tugas terjadwal lain, atau penjaga yang
 * dijalankan tanpa wrapper), `IPOS_URL` kosong dan agen memakai default
 * `127.0.0.1:8080` — yaitu proxy KEFA. Akibatnya agen mendorong katalog KEFA
 * SEBAGAI DATA CP: 4.708 item masuk ke slot CP, tampak "online" dan "segar",
 * padahal isinya toko yang salah. Tidak ada error, tidak ada peringatan.
 * Kesalahan senyap seperti ini jauh lebih berbahaya daripada tidak mengirim.
 *
 * Aturan precedence: env proses MENANG, lalu file. Sama dengan wrapper, jadi
 * perilaku produksi tidak berubah.
 */
function muatEnvBerkas() {
  const kandidat = [path.join(__dirname, 'push-agen.env'), path.join(ROOT, '.env')];
  for (const berkas of kandidat) {
    let isi;
    try { isi = fs.readFileSync(berkas, 'utf8'); } catch (_) { continue; }
    for (const baris of isi.split(/\r?\n/)) {
      const m = baris.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const nama = m[1];
      const nilai = m[2].trim().replace(/^["']|["']$/g, '');
      // Hanya isi yang belum ada: env proses tetap yang menang.
      if (!process.env[nama]) process.env[nama] = nilai;
    }
  }
}
muatEnvBerkas();

// ── KONFIGURASI ──────────────────────────────────────────────────────────
const PUSH_URL = String(process.env.PUSH_URL || '').replace(/\/+$/, '');
const PUSH_TOKEN = String(process.env.PUSH_TOKEN || '');
const JEDA_PENUH_MS = Number(process.env.PUSH_JEDA_PENUH_MS || 900000);
// Jeda laporan sekarang PER TOKO (lihat profilToko): CP/NK lebih longgar
// karena tiap tarikan membebani mesin toko lewat tailnet.
const JEDA_ULANG_MS = Number(process.env.PUSH_JEDA_ULANG_MS || 5000);

/**
 * Toko yang didorong. Alamat proxy lokal dibaca dari env yang SAMA dengan
 * yang dipakai bot, supaya tidak ada dua sumber kebenaran.
 *
 * Bila IPOS_*_URL tidak diisi (kasus normal di PC ini, karena URL itu hanya
 * berarti bagi bot di Railway), dipakai proxy lokal 127.0.0.1:8080. Kunci
 * dibaca langsung dari `.env` milik ipos-api TANPA PERNAH DICETAK — jadi
 * konfigurasi agen cukup PUSH_URL + PUSH_TOKEN saja.
 */
function bacaKunciDariEnvIposApi() {
  try {
    const isi = fs.readFileSync('C:\\Users\\rdpadmin\\ipos-api\\.env', 'utf8');
    for (const baris of isi.split(/\r?\n/)) {
      const m = baris.match(/^\s*API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    }
  } catch (_) { /* tidak ada -> biarkan kosong */ }
  return '';
}

/**
 * Apakah URL ini sumber yang SAH untuk agen yang berjalan DI PC INI?
 *
 * Agen berjalan di PC kasir. Sumber yang sah hanya dua:
 *   1. loopback (127.0.0.1 / localhost) — proxy lokal, kasus KEFA.
 *   2. tailnet 100.64.0.0/10 — mesin toko lain (CP, NK) yang TERBUKTI
 *      terjangkau dari PC ini. Ini alamat privat, bukan internet publik.
 *
 * Yang SENGAJA DITOLAK: alamat tunnel publik (trycloudflare dsb). Alamat itu
 * dibuat untuk bot di Railway, bukan untuk agen. Kalau diterima, agen akan
 * menarik data lewat internet publik padahal sumbernya ada di jaringan sendiri
 * — dan tunnel itulah yang dulu mati berulang kali.
 *
 * Catatan: filter ini DULU hanya mengizinkan loopback, dan itulah sebab langsung
 * CP & NK tidak pernah didorong sama sekali.
 */
function urlSumberSah(url) {
  const s = String(url || '');
  if (/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(s)) return true;
  const m = s.match(/^http:\/\/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(:\d+)?(\/|$)/i);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  // Tailscale CGNAT: 100.64.0.0/10 -> oktet kedua 64..127.
  return a === 100 && b >= 64 && b <= 127;
}

/**
 * PROFIL BEBAN PER TOKO — angka ini HASIL UKUR, bukan tebakan.
 *
 * KEFA : proxy lokal, katalog 780 KB / ~0,7 dtk. Poll 3 dtk murah.
 * CP   : 11.037 item, katalog 2.107 KB / ~1,1 dtk lewat tailnet. Kalau dipoll
 *        3 dtk, itu ~1,9 MB/dtk TERUS-MENERUS dan memakan satu inti PC kasir
 *        (PC yang sama yang melayani penjualan). 15 dtk sudah cukup: SSE CP
 *        TERBUKTI mengirim frame `items` sendiri.
 * NK   : 5.250 item, katalog 981 KB tetapi butuh ~6,1 dtk (mesinnya lemah).
 *        Poll rapat hanya menumpuk permintaan yang belum selesai.
 *
 * Delta tetap datang seketika lewat SSE. Poll stok hanyalah jaring pengaman
 * untuk proxy yang kanal item-nya cacat (cacat itu terbukti ada di KEFA).
 *
 * Semua bisa diatur lewat env, dan default KEFA dipertahankan persis seperti
 * sebelumnya supaya perilaku PC tidak berubah.
 */
function profilToko(nama) {
  const p = {
    kefa: {
      jedaStok: Number(process.env.PUSH_JEDA_STOK_MS || 3000),
      jedaLaporan: Number(process.env.PUSH_JEDA_LAPORAN_MS || 60000),
      jedaMerek: Number(process.env.PUSH_JEDA_MEREK_MS || 300000),
      jedaMarketplace: Number(process.env.PUSH_JEDA_MARKETPLACE_MS || 300000),
    },
    cp: {
      jedaStok: Number(process.env.PUSH_JEDA_STOK_MS_CP || 15000),
      jedaLaporan: Number(process.env.PUSH_JEDA_LAPORAN_MS_CP || 90000),
      jedaMerek: Number(process.env.PUSH_JEDA_MEREK_MS_CP || 300000),
      jedaMarketplace: Number(process.env.PUSH_JEDA_MARKETPLACE_MS_CP || 300000),
    },
    nk: {
      jedaStok: Number(process.env.PUSH_JEDA_STOK_MS_NK || 20000),
      jedaLaporan: Number(process.env.PUSH_JEDA_LAPORAN_MS_NK || 90000),
      jedaMerek: Number(process.env.PUSH_JEDA_MEREK_MS_NK || 300000),
      jedaMarketplace: Number(process.env.PUSH_JEDA_MARKETPLACE_MS_NK || 300000),
    },
  }[String(nama || '').toLowerCase()];
  // Toko tak dikenal (kalau nanti ditambah): pakai profil paling hemat.
  return p || {
    jedaStok: Number(process.env.PUSH_JEDA_STOK_MS || 15000),
    jedaLaporan: Number(process.env.PUSH_JEDA_LAPORAN_MS || 90000),
    jedaMerek: 300000,
    jedaMarketplace: 300000,
  };
}

function daftarToko() {
  const hanya = String(process.env.PUSH_TOKO || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const kunciLokal = bacaKunciDariEnvIposApi();
  const calon = [
    {
      toko: 'cp',
      url: process.env.IPOS_URL || 'http://127.0.0.1:8080/ipos',
      key: process.env.IPOS_KEY || kunciLokal,
    },
    { toko: 'nk', url: process.env.IPOS_NK_URL, key: process.env.IPOS_NK_KEY || kunciLokal },
    {
      toko: 'kefa',
      url: process.env.IPOS_KEFA_URL || 'http://127.0.0.1:8080/ipos',
      key: process.env.IPOS_KEFA_KEY || kunciLokal,
    },
  ];
  return calon
    .filter((t) => t.url && t.key)
    .filter((t) => !hanya.length || hanya.includes(t.toko))
    // Hanya loopback dan tailnet. Tunnel publik ditolak (lihat urlSumberSah).
    .filter((t) => urlSumberSah(t.url))
    .map((t) => ({ ...t, url: String(t.url).replace(/\/+$/, ''), profil: profilToko(t.toko) }));
}

/**
 * Dua toko menunjuk alamat yang SAMA berarti salah konfigurasi: data satu toko
 * akan masuk ke slot toko lain (mis. katalog KEFA tampil sebagai CP) tanpa
 * error apa pun. Ini pernah benar-benar terjadi ketika IPOS_URL kosong
 * sehingga `cp` jatuh ke default loopback yang sama dengan `kefa`.
 * Kembalikan daftar alamat ganda supaya pemanggil bisa menolak jalan.
 */
function alamatGanda(toko) {
  const peta = new Map();
  for (const t of toko) {
    const kunci = t.url.toLowerCase();
    if (!peta.has(kunci)) peta.set(kunci, []);
    peta.get(kunci).push(t.toko);
  }
  return [...peta.entries()].filter(([, daftar]) => daftar.length > 1)
    .map(([url, daftar]) => ({ url, toko: daftar }));
}

const status = {
  mulai: new Date().toISOString(),
  pid: process.pid,
  pushUrl: PUSH_URL || null,
  toko: [],
  siklus: 0,
  kiriman: { items: 0, 'items-ubah': 0, jual: 0 },
  gagal: 0,
  terakhirKirim: null,
  terakhirGagal: null,
  berhenti: null,
};

function tulisStatus() {
  status.diperbarui = new Date().toISOString();
  try { fs.writeFileSync(STATUS, JSON.stringify(status, null, 2), 'utf8'); } catch (_) { /* abaikan */ }
}

function catatGagal(toko, jenis, pesan) {
  status.gagal++;
  status.terakhirGagal = { waktu: new Date().toISOString(), toko, jenis, pesan: String(pesan).slice(0, 200) };
  tulisStatus();
}

// ── KUNCI TUNGGAL ────────────────────────────────────────────────────────
// Dua agen pendorong sekaligus akan mengirim data yang sama berulang kali dan
// membuat /health menampilkan angka push yang membingungkan.
function pidHidup(pid) {
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

function ambilLock() {
  try {
    if (fs.existsSync(LOCK)) {
      const isi = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
      if (isi && isi.pid && isi.pid !== process.pid && pidHidup(isi.pid)) {
        console.error('[PUSH] sudah ada agen berjalan (pid ' + isi.pid + ') - keluar');
        process.exit(2);
      }
    }
  } catch (_) { /* lock rusak -> ambil alih */ }
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, mulai: new Date().toISOString() }), 'utf8');
}

function lepasLock() {
  try {
    if (fs.existsSync(LOCK)) {
      const isi = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
      if (isi && isi.pid === process.pid) fs.unlinkSync(LOCK);
    }
  } catch (_) { /* abaikan */ }
}

// ── HTTP SEDERHANA (tanpa dependensi) ────────────────────────────────────
function minta(url, opsi = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('URL tidak sah: ' + url)); }
    const lib = u.protocol === 'https:' ? https : http;
    const badan = opsi.body == null ? null : Buffer.from(opsi.body);
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: opsi.method || 'GET',
      headers: {
        ...(opsi.headers || {}),
        ...(badan ? { 'content-length': badan.length } : {}),
      },
    }, (res) => {
      const potong = [];
      res.on('data', (d) => potong.push(d));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(potong).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.setTimeout(Number(opsi.timeout || 120000), () => req.destroy(new Error('timeout')));
    if (badan) req.write(badan);
    req.end();
  });
}

async function ambilJson(url, timeout) {
  const r = await minta(url, { timeout: timeout || 120000 });
  if (r.status !== 200) throw new Error('HTTP ' + r.status);
  return JSON.parse(r.body);
}

// ── DORONG ───────────────────────────────────────────────────────────────
let berhentiKarenaToken = false;

async function dorong(toko, jenis, data) {
  if (berhentiKarenaToken) return { dilewati: true };
  if (!PUSH_URL) throw new Error('PUSH_URL belum diisi');
  const isi = JSON.stringify({ toko, jenis, data });
  const r = await minta(PUSH_URL + '/api/ipos/push', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-push-token': PUSH_TOKEN,
      'content-length': Buffer.byteLength(isi),
    },
    body: isi,
    timeout: 180000,
  });

  if (r.status === 200) {
    status.kiriman[jenis] = (status.kiriman[jenis] || 0) + 1;
    status.terakhirKirim = { waktu: new Date().toISOString(), toko, jenis, jumlah: Array.isArray(data) ? data.length : null };
    // Server bisa meminta katalog penuh lewat respons 200 (denyut). Ini cara
    // pemulihan cepat setelah redeploy: penyimpanan server hanya di memori,
    // jadi setiap restart mengosongkannya. Tanpa jalur ini, PC baru mengirim
    // ulang saat jeda 15 menit tiba dan bot melayani toko tanpa data.
    let perluPenuh = false;
    try {
      const j = JSON.parse(r.body);
      perluPenuh = !!(j && j.perluPenuh);
    } catch (_) { /* bukan JSON -> abaikan */ }
    return { ok: true, perluPenuh };
  }

  if (r.status === 401 || r.status === 503) {
    // Salah konfigurasi. Mengulang terus hanya membebani server dan
    // menyembunyikan masalahnya. Berhenti dan laporkan.
    berhentiKarenaToken = true;
    status.berhenti = 'HTTP ' + r.status + ': token ditolak / PUSH_TOKEN kosong di server';
    console.error('[PUSH] BERHENTI: ' + status.berhenti);
    tulisStatus();
    return { gagal: true, alasan: status.berhenti };
  }

  if (r.status === 409) {
    // Belum ada katalog penuh di server (mis. setelah redeploy). Minta
    // pemanggil mengirim katalog penuh lebih dulu.
    return { perluPenuh: true, alasan: 'server belum punya katalog penuh' };
  }

  throw new Error('HTTP ' + r.status + ' ' + String(r.body || '').slice(0, 120));
}

// ── PER TOKO ─────────────────────────────────────────────────────────────
function buatToko(t) {
  const profil = t.profil || profilToko(t.toko);
  const keadaan = {
    toko: t.toko,
    items: 0,
    sse: 'belum',
    terakhirPenuh: null,
    terakhirDelta: null,
    terakhirLaporan: null,
    terakhirMerek: null,
    terakhirMarketplace: null,
    err: null,
  };
  let penuhTerakhir = 0;
  let laporanTerakhir = 0;
  let laporanSedangJalan = false;
  let merekTerakhir = 0;
  let merekSedangJalan = false;
  let marketplaceTerakhir = 0;
  let marketplaceSedangJalan = false;
  let permintaanSedangJalan = false;

  /**
   * PETA STOK TERAKHIR — dipakai mendeteksi perubahan stok SENDIRI.
   *
   * KENAPA AGEN HARUS MELAKUKAN INI
   * -------------------------------
   * Proxy lokal hanya menyiarkan frame `items` bila NAMA/SATUAN/HARGA/HPP/
   * STATUSJUAL berubah (lihat server.js baris 124-125). **`stok` tidak ikut
   * dibandingkan**, padahal nota penjualan justru mengubah stok, bukan harga.
   * Lebih jauh, perbandingan itu berjalan SEBELUM stok diisi, jadi saat
   * dibandingkan `stok` masih 0 untuk semua item.
   *
   * Akibatnya: menyalakan SSE saja TIDAK membuat stok realtime. Tanpa deteksi
   * sendiri di sini, penjualan di toko tidak akan pernah sampai ke Railway
   * sampai katalog penuh berikutnya (15 menit) — persis keluhan "tidak update".
   *
   * Proxy TIDAK saya ubah: ia proses produksi yang sedang melayani toko, dan
   * menghentikannya untuk memasang perbaikan justru membuat data berhenti.
   * Deteksi di sisi agen memberi hasil yang sama tanpa menyentuh produksi.
   */
  const stokTerakhir = new Map();
  let selisihSedangJalan = false;

  /** Bandingkan stok sekarang dengan yang terakhir dikirim; dorong bila beda. */
  async function kirimSelisihStok() {
    if (selisihSedangJalan) return 0;
    selisihSedangJalan = true;
    try {
      const j = await ambilJson(t.url + '/api/items?key=' + encodeURIComponent(t.key), 120000);
      const items = Array.isArray(j && j.data) ? j.data : null;
      if (!items || !items.length) return 0;

      const delta = [];
      for (const it of items) {
        if (!it || !it.kode) continue;
        const k = String(it.kode).toUpperCase();
        const stokBaru = Number(it.stok);
        const stokLama = stokTerakhir.get(k);
        // `undefined` = belum pernah dikirim. Jangan dianggap delta: katalog
        // penuh yang baru dikirim sudah mencakup semuanya, jadi cukup dicatat.
        if (stokLama === undefined) { stokTerakhir.set(k, stokBaru); continue; }
        if (stokLama !== stokBaru) {
          stokTerakhir.set(k, stokBaru);
          delta.push(it);
        }
      }

      if (!delta.length) return 0;
      console.log('[PUSH] ' + t.toko + ': ' + delta.length + ' item berubah STOK (tanpa frame SSE)');
      const r = await dorong(t.toko, 'items-ubah', delta);
      if (r && r.perluPenuh) {
        await kirimPenuh();
        return 0;
      }
      keadaan.terakhirDelta = new Date().toISOString();
      return delta.length;
    } catch (e) {
      catatGagal(t.toko, 'items-ubah', e.message);
      return 0;
    } finally {
      selisihSedangJalan = false;
    }
  }

  /** Catat stok dari katalog penuh agar pembanding berikutnya punya dasar. */
  function catatStokPenuh(items) {
    stokTerakhir.clear();
    for (const it of items) {
      if (it && it.kode) stokTerakhir.set(String(it.kode).toUpperCase(), Number(it.stok));
    }
  }

  /** Katalog penuh. */
  async function kirimPenuh() {
    const j = await ambilJson(t.url + '/api/items?key=' + encodeURIComponent(t.key), 120000);
    const items = Array.isArray(j && j.data) ? j.data : null;
    if (!items || !items.length) throw new Error('katalog kosong dari proxy');
    await dorong(t.toko, 'items', items);
    catatStokPenuh(items);
    keadaan.items = items.length;
    keadaan.terakhirPenuh = new Date().toISOString();
    penuhTerakhir = Date.now();
    return items.length;
  }

  /**
   * Tempelkan SEBAB kebekuan ke laporan, HANYA bila laporan itu memang beku.
   *
   * KENAPA PERLU
   * ------------
   * Proxy melaporkan galat DB-nya di `/health` (`jual.err`), BUKAN di respons
   * `/api/jual`. Akibatnya laporan yang dikirim hanya membawa angka beku tanpa
   * sebab, dan pengguna hanya bisa diberi tahu "laporan beku" tanpa tahu apa
   * yang harus diperbaiki. Sebabnya itulah yang menentukan siapa yang harus
   * bertindak: rute DB di mesin toko, atau bug di proxy.
   *
   * KENAPA HANYA SAAT BEKU
   * ----------------------
   * Satu permintaan tambahan per laporan per toko. Saat data segar, informasi
   * itu tidak berguna, jadi jangan dibayar. Ambangnya sama dengan ambang
   * peringatan di bot (10 menit) supaya keduanya tidak berbeda pendapat.
   */
  async function tempelSebabBilaBeku(t, laporan) {
    try {
      const upd = Number(laporan && laporan.update);
      if (!Number.isFinite(upd) || upd <= 0) return laporan;
      const updMs = upd > 1e12 ? upd : upd * 1000;
      if (Date.now() - updMs < 10 * 60 * 1000) return laporan; // masih segar
      const h = await ambilJson(t.url + '/health?key=' + encodeURIComponent(t.key), 20000);
      const sebab = h && h.jual && h.jual.err;
      if (sebab) laporan.updateSebab = String(sebab).slice(0, 120);
    } catch (_) {
      // Sebab hanya pelengkap. Kegagalan mengambilnya tidak boleh
      // menggagalkan pengiriman laporan yang sudah berhasil didapat.
    }
    return laporan;
  }

  /** Laporan penjualan hari ini. */
  async function kirimLaporan(paksa) {
    if (laporanSedangJalan) return;
    if (!paksa && Date.now() - laporanTerakhir < profil.jedaLaporan) return;
    laporanSedangJalan = true;
    try {
      const d = new Date();
      const tgl = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const j = await ambilJson(
        t.url + '/api/jual?dari=' + tgl + '&sampai=' + tgl + '&key=' + encodeURIComponent(t.key),
        60000,
      );
      if (!j || typeof j !== 'object') throw new Error('laporan kosong');
      await tempelSebabBilaBeku(t, j);
      await dorong(t.toko, 'jual', j);
      keadaan.terakhirLaporan = new Date().toISOString();
      laporanTerakhir = Date.now();
    } catch (e) {
      keadaan.err = 'laporan: ' + String(e.message).slice(0, 120);
    } finally {
      laporanSedangJalan = false;
    }
  }

  /**
   * Laporan PENJUALAN PER MEREK dan MARKETPLACE.
   *
   * KENAPA IKUT DIDORONG
   * --------------------
   * Tanpa ini, di Railway laporan merek & marketplace hanya hidup kalau bot
   * bisa menjangkau iPos langsung — dan itu sudah tidak mungkin untuk CP/NK.
   * Fitur itu akan mati diam-diam (bot menampilkan nol) meskipun katalognya
   * segar. Karena itu ketiga bentuk laporan didorong bersama.
   *
   * Objek yang dikirim adalah respons APA ADANYA dari proxy, termasuk `dari`
   * dan `sampai`. Bridge memakai dua field itu untuk MENOLAK permintaan
   * rentang tanggal lain, supaya tidak pernah menyajikan angka yang salah
   * tanpa peringatan.
   *
   * Jeda 5 menit cukup: laporan merek/marketplace dipakai untuk rekap, bukan
   * untuk memantau detik-per-detik, dan tiap tarikan membebani mesin toko.
   */
  async function kirimLaporanTambahan(jenis, jalur, paksa) {
    const sedang = jenis === 'jual-merek'
      ? () => merekSedangJalan
      : () => marketplaceSedangJalan;
    if (sedang()) return;
    const terakhir = jenis === 'jual-merek' ? merekTerakhir : marketplaceTerakhir;
    const jeda = jenis === 'jual-merek' ? profil.jedaMerek : profil.jedaMarketplace;
    if (!paksa && Date.now() - terakhir < jeda) return;
    if (jenis === 'jual-merek') merekSedangJalan = true;
    else marketplaceSedangJalan = true;
    try {
      const d = new Date();
      const tgl = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const j = await ambilJson(
        t.url + jalur + '?dari=' + tgl + '&sampai=' + tgl + '&key=' + encodeURIComponent(t.key),
        90000,
      );
      if (!j || typeof j !== 'object') throw new Error(jenis + ' kosong');
      await dorong(t.toko, jenis, j);
      if (jenis === 'jual-merek') { keadaan.terakhirMerek = new Date().toISOString(); merekTerakhir = Date.now(); }
      else { keadaan.terakhirMarketplace = new Date().toISOString(); marketplaceTerakhir = Date.now(); }
    } catch (e) {
      keadaan.err = jenis + ': ' + String(e.message).slice(0, 120);
    } finally {
      if (jenis === 'jual-merek') merekSedangJalan = false;
      else marketplaceSedangJalan = false;
    }
  }

  const kirimMerek = (paksa) => kirimLaporanTambahan('jual-merek', '/api/jual-merek', paksa);
  const kirimMarketplace = (paksa) => kirimLaporanTambahan('jual-marketplace', '/api/jual-marketplace', paksa);

  /**
   * PENUHI PESANAN LAPORAN TANGGAL LAMPAU.
   *
   * Bot di Railway tidak bisa menjangkau iPos (CGNAT), jadi saat pengguna minta
   * laporan tanggal lampau — mis. marketplace CP 14/11/2026 — server hanya bisa
   * mencatat pesanan. Fungsi ini menjemput pesanan itu, mengambil laporannya
   * dari proxy di toko, lalu mengirimnya. Hasilnya disimpan server per rentang,
   * sehingga pertanyaan berikutnya untuk tanggal yang sama tidak perlu ke PC.
   *
   * PENTING: yang dikirim adalah respons APA ADANYA. Server memakai `dari`/
   * `sampai` dari isi laporan itu untuk menyimpannya, jadi rentang yang
   * tersimpan selalu persis yang diminta — tidak ada pencampuran tanggal.
   */
  const jalurLaporan = {
    jual: '/api/jual',
    'jual-merek': '/api/jual-merek',
    'jual-marketplace': '/api/jual-marketplace',
  };

  async function penuhiPermintaan() {
    if (permintaanSedangJalan) return;
    if (!PUSH_URL) return;
    permintaanSedangJalan = true;
    try {
      const r = await minta(
        PUSH_URL + '/api/ipos/perlu?toko=' + encodeURIComponent(t.toko),
        { timeout: 20000, headers: { 'x-push-token': PUSH_TOKEN } },
      );
      if (r.status !== 200) {
        // Gangguan sesaat (jaringan, redeploy) TIDAK dicatat sebagai kegagalan.
        // Penjemput berjalan tiap 2 dtk, dan `catatGagal` menulis berkas status
        // setiap kali dipanggil — mencatat tiap gangguan akan menulis disk
        // terus-menerus dan mengubur kegagalan yang sungguhan. Hanya salah
        // konfigurasi (401/503) yang perlu terlihat, dan itu pun sekali saja.
        if ((r.status === 401 || r.status === 503) && keadaan.err !== 'perlu: HTTP ' + r.status) {
          keadaan.err = 'perlu: HTTP ' + r.status;
          catatGagal(t.toko, 'permintaan', 'HTTP ' + r.status + ' saat menjemput pesanan');
        }
        return;
      }
      // Berhasil menjemput: bersihkan galat penjemput sebelumnya.
      if (keadaan.err && keadaan.err.startsWith('perlu:')) keadaan.err = null;
      let j = null;
      try { j = JSON.parse(r.body); } catch (_) { return; }
      const daftar = Array.isArray(j && j.permintaan) ? j.permintaan : [];
      if (!daftar.length) return;
      for (const p of daftar) {
        const jalur = jalurLaporan[p.jenis];
        if (!jalur) continue;
        const dari = String(p.dari || '').slice(0, 10);
        const sampai = String(p.sampai || dari).slice(0, 10);
        if (!dari) continue;
        try {
          const lap = await ambilJson(
            t.url + jalur + '?dari=' + encodeURIComponent(dari)
              + '&sampai=' + encodeURIComponent(sampai)
              + '&key=' + encodeURIComponent(t.key),
            120000,
          );
          if (!lap || typeof lap !== 'object') throw new Error('laporan kosong');
          await dorong(t.toko, p.jenis, lap);
          console.log('[PUSH] ' + t.toko + ': pesanan ' + p.jenis + ' ' + dari + ' s/d ' + sampai + ' dipenuhi');
        } catch (e) {
          // Pesanan dibiarkan; server membuangnya sendiri setelah 10 menit.
          catatGagal(t.toko, 'permintaan', p.jenis + ' ' + dari + ': ' + String(e.message).slice(0, 90));
        }
      }
    } catch (e) {
      // Sama seperti di atas: gangguan jaringan sesaat bukan kegagalan yang
      // perlu dicatat tiap 2 detik.
      return;
    } finally {
      permintaanSedangJalan = false;
    }
  }

  /**
   * Langganan SSE proxy lokal.
   * Ini sumber PERUBAHAN: setiap frame `items` = delta yang langsung didorong,
   * sehingga Railway tahu perubahan dalam hitungan detik, bukan menit.
   */
  function mulaiSSE() {
    let gagal = 0;
    const sambung = () => {
      let u;
      try { u = new URL(t.url + '/api/events?key=' + encodeURIComponent(t.key)); } catch (_) { return; }
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request({
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        headers: { accept: 'text/event-stream' },
      }, (res) => {
        if (res.statusCode !== 200) {
          keadaan.sse = 'HTTP ' + res.statusCode;
          res.resume();
          return jadwalUlang();
        }
        keadaan.sse = 'hidup';
        gagal = 0;
        console.log('[PUSH] ' + t.toko + ': SSE tersambung ke ' + t.url + ' (sumber delta)');
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (potongan) => {
          buf += potongan;
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, i);
            buf = buf.slice(i + 2);
            let ev = '', data = '';
            for (const baris of frame.split('\n')) {
              if (baris.startsWith('event:')) ev = baris.slice(6).trim();
              else if (baris.startsWith('data:')) data += baris.slice(5).trim();
            }
            if (!data) continue;
            if (ev === 'items') {
              let arr = null;
              try { arr = JSON.parse(data); } catch (_) { arr = null; }
              if (Array.isArray(arr) && arr.length) {
                console.log('[PUSH] ' + t.toko + ': delta ' + arr.length + ' item dari SSE');
                dorong(t.toko, 'items-ubah', arr)
                  .then((r) => {
                    if (r && r.perluPenuh) {
                      // Server belum punya katalog penuh (redeploy) -> kirim penuh.
                      return kirimPenuh();
                    }
                    keadaan.terakhirDelta = new Date().toISOString();
                    return null;
                  })
                  .catch((e) => catatGagal(t.toko, 'items-ubah', e.message));
              }
            } else if (ev === 'jual') {
              // Nota baru: stok PASTI berubah. Kirim laporan segera.
              void kirimLaporan(true);
            }
          }
        });
        res.on('end', () => { keadaan.sse = 'putus'; jadwalUlang(); });
        res.on('error', () => { keadaan.sse = 'putus'; jadwalUlang(); });
      });
      req.on('error', () => { keadaan.sse = 'putus'; jadwalUlang(); });
      req.setTimeout(0);
      req.end();

      function jadwalUlang() {
        gagal++;
        const jeda = Math.min(30000, 1000 * Math.pow(2, Math.min(5, gagal - 1)));
        setTimeout(sambung, jeda);
      }
    };
    sambung();
  }

  return {
    keadaan, kirimPenuh, kirimLaporan, kirimSelisihStok, kirimMerek, kirimMarketplace, mulaiSSE, profil, penuhiPermintaan,
    get penuhTerakhir() { return penuhTerakhir; },
  };
}

// ── JALAN ────────────────────────────────────────────────────────────────
(async () => {
  if (!PUSH_URL) {
    console.error('[PUSH] PUSH_URL belum diisi - tidak ada yang didorong');
    process.exit(1);
  }
  if (!PUSH_TOKEN) {
    console.error('[PUSH] PUSH_TOKEN belum diisi - server akan menolak semua kiriman');
    process.exit(1);
  }

  ambilLock();
  process.on('exit', lepasLock);
  process.on('SIGINT', () => { lepasLock(); process.exit(0); });
  process.on('SIGTERM', () => { lepasLock(); process.exit(0); });

  const toko = daftarToko();
  if (!toko.length) {
    console.error('[PUSH] tidak ada toko dengan IPOS_*_URL + IPOS_*_KEY - keluar');
    process.exit(1);
  }

  // DUA TOKO SATU ALAMAT = data toko yang salah masuk ke slot toko lain.
  // Contoh nyata: IPOS_URL kosong -> `cp` memakai default loopback yang sama
  // dengan `kefa`, sehingga 4.708 item KEFA dikirim sebagai katalog CP.
  // Tidak ada error dan /health tampak sehat, jadi ini WAJIB ditolak di sini.
  const ganda = alamatGanda(toko);
  if (ganda.length) {
    for (const g of ganda) {
      console.error('[PUSH] FATAL: toko ' + g.toko.join(' + ') + ' menunjuk alamat yang SAMA: ' + g.url);
    }
    console.error('[PUSH] isi IPOS_URL / IPOS_NK_URL / IPOS_KEFA_URL dengan alamat masing-masing toko.');
    process.exit(1);
  }

  status.toko = toko.map((t) => t.toko);
  tulisStatus();
  console.log('[PUSH] mendorong ' + toko.map((t) => t.toko + ' (' + t.url + ')').join(', ') + ' -> ' + PUSH_URL);
  console.log('[PUSH] katalog penuh tiap ' + Math.round(JEDA_PENUH_MS / 60000) + ' menit; delta via SSE');
  console.log('[PUSH] jeda stok: ' + toko.map((t) => t.toko + '=' + Math.round(t.profil.jedaStok / 1000) + 'dtk').join(', '));

  const agen = toko.map(buatToko);

  // Katalog penuh awal, berurutan supaya tidak menabrak RAM/IO.
  for (const a of agen) {
    try {
      const n = await a.kirimPenuh();
      console.log('[PUSH] ' + a.keadaan.toko + ': katalog awal ' + n + ' item terkirim');
    } catch (e) {
      catatGagal(a.keadaan.toko, 'items', e.message);
      console.error('[PUSH] ' + a.keadaan.toko + ': katalog awal gagal - ' + e.message);
    }
  }

  // Laporan awal. Merek & marketplace ikut, karena setelah redeploy memori
  // server kosong dan fitur rekap itu akan tampak "nol" sampai 5 menit
  // berikutnya kalau tidak dikirim sekarang.
  for (const a of agen) {
    await a.kirimLaporan(true);
    await a.kirimMerek(true);
    await a.kirimMarketplace(true);
  }

  // SSE: sumber perubahan realtime.
  for (const a of agen) a.mulaiSSE();

  /**
   * DENYUT — bukti PC masih hidup, terpisah dari isi data.
   *
   * Kenapa perlu: tanpa denyut, satu-satunya bukti PC hidup adalah umur data.
   * Padahal toko sepi wajar tidak mengubah item selama berjam-jam. Akibatnya
   * "data lama" dan "PC mati" tampak sama dari sisi server — dua hal yang
   * sangat berbeda, dan menyamakannya membuat alarm tidak bisa dipercaya.
   */
  // Denyut PERTAMA dikirim segera, jangan menunggu interval.
  //
  // Alasannya: setelah agen restart, server belum tahu PC hidup sampai denyut
  // berikutnya tiba. Selama jeda itu /health menampilkan denyut yang makin tua
  // padahal semuanya sehat — dan itu terlihat persis seperti gangguan.
  for (const a of agen) {
    try {
      const r = await dorong(a.keadaan.toko, 'denyut', { hidup: true });
      if (r && r.perluPenuh) {
        const n = await a.kirimPenuh();
        console.log('[PUSH] ' + a.keadaan.toko + ': server kosong saat start - katalog dipulihkan ' + n + ' item');
        await a.kirimLaporan(true);
        await a.kirimMerek(true);
        await a.kirimMarketplace(true);
      }
    } catch (e) {
      catatGagal(a.keadaan.toko, 'denyut', e.message);
    }
  }

  const denyut = setInterval(async () => {
    for (const a of agen) {
      try {
        const r = await dorong(a.keadaan.toko, 'denyut', { hidup: true });
        // Server baru saja restart / redeploy: penyimpanannya kosong. Kirim
        // katalog penuh SEKARANG, jangan tunggu jeda 15 menit — selama itu bot
        // akan melayani toko tanpa data.
        if (r && r.perluPenuh) {
          console.log('[PUSH] ' + a.keadaan.toko + ': server kosong (redeploy?) - kirim katalog penuh segera');
          try {
            const n = await a.kirimPenuh();
            console.log('[PUSH] ' + a.keadaan.toko + ': katalog dipulihkan ' + n + ' item');
          } catch (e2) {
            catatGagal(a.keadaan.toko, 'items', e2.message);
          }
          // Laporan juga hilang bersama memori server.
          await a.kirimLaporan(true);
          await a.kirimMerek(true);
          await a.kirimMarketplace(true);
        }
      } catch (e) {
        catatGagal(a.keadaan.toko, 'denyut', e.message);
      }
    }
  }, Number(process.env.PUSH_JEDA_DENYUT_MS || 30000));
  if (denyut.unref) denyut.unref();

  // ── PEMANTAU STOK (loop cepat, JEDA PER TOKO) ───────────────────────
  //
  // DIPISAH dari `pengawas` 30 detik, dan itu penting: perubahan stok akibat
  // penjualan harus terlihat dalam hitungan detik. Menumpangkannya pada loop
  // 30 detik membuat "realtime" hanya nama — pembeli bisa melihat stok lama
  // sampai setengah menit.
  //
  // JEDA BERBEDA PER TOKO karena biayanya berbeda jauh (hasil ukur):
  //   KEFA 780 KB / 0,7 dtk di localhost  -> 3 dtk
  //   CP   2.107 KB / 1,1 dtk lewat tailnet -> 15 dtk (SSE CP kirim `items`)
  //   NK   981 KB / 6,1 dtk (mesin lemah)   -> 20 dtk
  // Satu jeda global akan membuat CP/NK memakan bandwidth tailnet terus-menerus
  // atau membuat KEFA tidak realtime. Jadi tiap toko punya pewaktu sendiri.
  const pewaktuStok = [];
  for (const a of agen) {
    const t = setInterval(async () => {
      try { await a.kirimSelisihStok(); }
      catch (e) { catatGagal(a.keadaan.toko, 'items-ubah', e.message); }
    }, a.profil.jedaStok);
    if (t.unref) t.unref();
    pewaktuStok.push(t);
  }

  // ── PENJEMPUT PESANAN LAPORAN TANGGAL LAMPAU ────────────────────────
  //
  // Server (Railway) tidak bisa menjangkau iPos di toko, jadi saat pengguna
  // minta laporan tanggal lampau server hanya bisa mencatat pesanan. Loop ini
  // menjemput pesanan itu tiap beberapa detik. Murah: satu GET kecil per toko,
  // dan biasanya tidak ada isinya. Jeda dibuat pendek supaya pengguna tidak
  // menunggu lama, tetapi tidak terlalu rapat supaya tidak membebani server.
  const pewaktuPermintaan = [];
  for (const a of agen) {
    const t = setInterval(async () => {
      try { await a.penuhiPermintaan(); }
      catch (e) { catatGagal(a.keadaan.toko, 'permintaan', e.message); }
    }, Number(process.env.PUSH_JEDA_PERMINTAAN_MS || 2000));
    if (t.unref) t.unref();
    pewaktuPermintaan.push(t);
  }

  // Jaring pengaman: katalog penuh berkala + laporan berkala.
  const pengawas = setInterval(async () => {
    status.siklus++;
    for (const a of agen) {
      try {
        if (Date.now() - a.penuhTerakhir >= JEDA_PENUH_MS) {
          const n = await a.kirimPenuh();
          console.log('[PUSH] ' + a.keadaan.toko + ': katalog penuh berkala ' + n + ' item');
        }
      } catch (e) {
        catatGagal(a.keadaan.toko, 'items', e.message);
      }
      await a.kirimLaporan(false);
      await a.kirimMerek(false);
      await a.kirimMarketplace(false);
    }
    tulisStatus();
  }, 30000);
  if (pengawas.unref) pengawas.unref();

  // Status ditulis berkala supaya bisa diperiksa tanpa menghentikan agen.
  const penulis = setInterval(tulisStatus, 15000);
  if (penulis.unref) penulis.unref();

  // Jaga proses tetap hidup; SSE menahan event loop, tapi ini jaring pengaman.
  setInterval(() => { tulisStatus(); }, 60000);
})().catch((e) => {
  console.error('[PUSH] FATAL: ' + ((e && e.stack) || e));
  process.exit(1);
});

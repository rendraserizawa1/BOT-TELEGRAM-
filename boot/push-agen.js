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
 *   PUSH_TOKO=kefa            (default: semua toko yang IPOS_*_URL-nya ada)
 *   PUSH_JEDA_PENUH_MS=900000 (katalog penuh tiap 15 menit)
 *   PUSH_JEDA_LAPORAN_MS=60000
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const STATUS = path.join(__dirname, 'push-status.json');
const LOCK = path.join(__dirname, '.push-agen.lock');

// ── KONFIGURASI ──────────────────────────────────────────────────────────
const PUSH_URL = String(process.env.PUSH_URL || '').replace(/\/+$/, '');
const PUSH_TOKEN = String(process.env.PUSH_TOKEN || '');
const JEDA_PENUH_MS = Number(process.env.PUSH_JEDA_PENUH_MS || 900000);
const JEDA_LAPORAN_MS = Number(process.env.PUSH_JEDA_LAPORAN_MS || 60000);
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
    // Jangan mendorong toko yang URL-nya menunjuk ke luar (tunnel/tailnet):
    // itu alamat untuk bot di Railway, bukan untuk agen di PC ini.
    .filter((t) => /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])/i.test(String(t.url)))
    .map((t) => ({ ...t, url: String(t.url).replace(/\/+$/, '') }));
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
    return { ok: true };
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
  const keadaan = {
    toko: t.toko,
    items: 0,
    sse: 'belum',
    terakhirPenuh: null,
    terakhirDelta: null,
    terakhirLaporan: null,
    err: null,
  };
  let penuhTerakhir = 0;
  let laporanTerakhir = 0;
  let laporanSedangJalan = false;

  /** Katalog penuh. */
  async function kirimPenuh() {
    const j = await ambilJson(t.url + '/api/items?key=' + encodeURIComponent(t.key), 120000);
    const items = Array.isArray(j && j.data) ? j.data : null;
    if (!items || !items.length) throw new Error('katalog kosong dari proxy');
    await dorong(t.toko, 'items', items);
    keadaan.items = items.length;
    keadaan.terakhirPenuh = new Date().toISOString();
    penuhTerakhir = Date.now();
    return items.length;
  }

  /** Laporan penjualan hari ini. */
  async function kirimLaporan(paksa) {
    if (laporanSedangJalan) return;
    if (!paksa && Date.now() - laporanTerakhir < JEDA_LAPORAN_MS) return;
    laporanSedangJalan = true;
    try {
      const d = new Date();
      const tgl = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const j = await ambilJson(
        t.url + '/api/jual?dari=' + tgl + '&sampai=' + tgl + '&key=' + encodeURIComponent(t.key),
        60000,
      );
      if (!j || typeof j !== 'object') throw new Error('laporan kosong');
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
        console.log('[PUSH] ' + t.toko + ': SSE proxy lokal tersambung (sumber delta)');
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

  return { keadaan, kirimPenuh, kirimLaporan, mulaiSSE, get penuhTerakhir() { return penuhTerakhir; } };
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

  status.toko = toko.map((t) => t.toko);
  tulisStatus();
  console.log('[PUSH] mendorong ' + toko.map((t) => t.toko).join(', ') + ' -> ' + PUSH_URL);
  console.log('[PUSH] katalog penuh tiap ' + Math.round(JEDA_PENUH_MS / 60000) + ' menit; delta via SSE');

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

  // Laporan awal.
  for (const a of agen) await a.kirimLaporan(true);

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
  const denyut = setInterval(async () => {
    for (const a of agen) {
      try {
        await dorong(a.keadaan.toko, 'denyut', { hidup: true });
      } catch (e) {
        catatGagal(a.keadaan.toko, 'denyut', e.message);
      }
    }
  }, Number(process.env.PUSH_JEDA_DENYUT_MS || 30000));
  if (denyut.unref) denyut.unref();

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

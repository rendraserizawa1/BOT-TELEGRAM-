'use strict';
/**
 * PENGAWAS TUNNEL iPos — menjaga jalur Railway -> PC ini tetap hidup.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * 2026-11-15 terbukti: ketiga hostname `*.trycloudflare.com` yang dipakai bot
 * Railway sudah TIDAK ADA di DNS (ENOTFOUND). Artinya proses cloudflared mati
 * dan Cloudflare menghapus record-nya. Bot lalu melaporkan `fetch failed`
 * untuk SEMUA toko, padahal proxy KEFA lokal sehat (nota 43 / Rp 9.769.500).
 *
 * Tunnel quick Cloudflare TIDAK BISA dijamin 24/7 — URL-nya mati bersama
 * prosesnya. Karena itu berkas ini:
 *   1. hanya membuat tunnel untuk toko yang SERVER SUMBERNYA benar-benar hidup
 *      (jangan bikin tunnel ke target mati),
 *   2. memantau tiap tunnel terus-menerus; kalau mati -> dibuat ulang,
 *   3. memperbarui variabel Railway HANYA bila URL berubah,
 *   4. tidak pernah menjalankan dua salinan dirinya (lock file),
 *   5. menulis status ke boot/tunnel-status.json untuk diawasi.
 *
 * YANG TIDAK DILAKUKAN
 * --------------------
 * Berkas ini TIDAK pernah menyalakan bot lokal dan TIDAK pernah menyentuh
 * polling Telegram. Bot hanya boleh satu: yang di Railway.
 *
 * Pemakaian:  node boot\jaga-tunnel.js
 */

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const CF = path.join(__dirname, 'cloudflared.exe');
const CLI = 'C:/Users/rdpadmin/AppData/Roaming/npm/node_modules/@railway/cli/bin/railway.js';
const DOMAIN = 'https://kefa-bot-production.up.railway.app';
const SERVICE = 'kefa-bot';
const LOCK = path.join(__dirname, '.jaga-tunnel.lock');
const STATUS = path.join(__dirname, 'tunnel-status.json');

// Jeda antar siklus pemeriksaan (ms).
const JEDA_PERIKSA = 60 * 1000;
// Berapa lama menunggu Railway memakai URL baru sebelum menyerah (ms).
const TENGGANG_DEPLOY = 6 * 60 * 1000;

const SASARAN = [
  { nama: 'IPOS_URL', toko: 'CP', sumber: 'http://100.125.99.99:8080', kunciEnv: 'IPOS_KEY' },
  { nama: 'IPOS_NK_URL', toko: 'NK', sumber: 'http://100.110.152.33:8080', kunciEnv: 'IPOS_NK_KEY' },
  { nama: 'IPOS_KEFA_URL', toko: 'KEFA', sumber: 'http://127.0.0.1:8080', kunciEnv: 'IPOS_KEFA_KEY' },
];

const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
const jam = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const catat = (...a) => console.log('[' + jam() + ']', ...a);

/** .env dibaca ke memori; isi rahasia TIDAK PERNAH dicetak. */
function bacaEnv() {
  const env = {};
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return env;
  for (const b of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = b.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}
const ENV = bacaEnv();

/** Kunci API untuk satu toko; dibaca dari .env bot, cadangan dari .env proxy. */
function kunciUntuk(namaEnv) {
  if (ENV[namaEnv]) return ENV[namaEnv];
  try {
    const p = 'C:\\Users\\rdpadmin\\ipos-api\\.env';
    if (fs.existsSync(p)) {
      for (const b of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = b.match(/^\s*API_KEY\s*=\s*(.*)$/);
        if (m) return m[1].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch (_) { /* abaikan */ }
  return '';
}

// ---------------------------------------------------------------- lock tunggal
function ambilLock() {
  try {
    if (fs.existsSync(LOCK)) {
      const isi = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
      if (isi.pid && isi.pid !== process.pid) {
        try {
          process.kill(isi.pid, 0); // masih hidup?
          return { ok: false, pid: isi.pid };
        } catch (_) { /* sudah mati -> lanjut ambil alih */ }
      }
    }
  } catch (_) { /* lock rusak -> timpa */ }
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, mulai: new Date().toISOString() }), 'utf8');
  return { ok: true };
}
function lepasLock() {
  try {
    if (fs.existsSync(LOCK)) {
      const isi = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
      if (isi.pid === process.pid) fs.unlinkSync(LOCK);
    }
  } catch (_) { /* abaikan */ }
}

// ------------------------------------------------------------------- status IO
const status = {
  mulai: new Date().toISOString(),
  pid: process.pid,
  siklus: 0,
  sasaran: {},
};
// Proses anak disimpan TERPISAH dari `status` supaya berkas status tetap bersih
// dan tidak memuat objek ChildProcess mentah.
const prosesAktif = new Map();

function tulisStatus() {
  status.diperbarui = new Date().toISOString();
  try { fs.writeFileSync(STATUS, JSON.stringify(status, null, 2), 'utf8'); } catch (_) { /* abaikan */ }
}

// ------------------------------------------------------------------- HTTP util
async function ambilJson(url, kunci, timeoutMs) {
  const r = await fetch(url, {
    headers: kunci ? { 'x-api-key': kunci } : {},
    signal: AbortSignal.timeout(timeoutMs || 20000),
  });
  const teks = await r.text();
  let j = null;
  try { j = JSON.parse(teks); } catch (_) { /* bukan JSON */ }
  return { status: r.status, j, teks };
}

/** Apakah server SUMBER (di PC/tailnet) benar-benar melayani? */
async function sumberHidup(s) {
  try {
    const h = await ambilJson(s.sumber + '/ipos/health', null, 12000);
    if (h.status !== 200 || !h.j) return { hidup: false, alasan: 'HTTP ' + h.status };
    return { hidup: true, items: h.j.items, jual: h.j.jual };
  } catch (e) {
    return { hidup: false, alasan: (e.cause && e.cause.code) || e.name || String(e.message).slice(0, 60) };
  }
}

// -------------------------------------------------------------- buat tunnel
function buatTunnel(s) {
  const logFile = path.join(os.tmpdir(), 'cf-jaga-' + s.toko + '-' + Date.now() + '.log');
  const fd = fs.openSync(logFile, 'w');
  const anak = spawn(CF, ['tunnel', '--url', s.sumber, '--no-autoupdate'], {
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  });
  anak.on('exit', () => { try { fs.closeSync(fd); } catch (_) { /* abaikan */ } });
  return { anak, logFile };
}

async function tungguUrl(logFile, maksDetik) {
  for (let i = 0; i < maksDetik * 2; i++) {
    await tidur(500);
    let teks = '';
    try { teks = fs.readFileSync(logFile, 'utf8'); } catch (_) { /* belum ada */ }
    const m = teks.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) return m[0];
  }
  return null;
}

/** Pasang satu sasaran: sumber harus hidup -> tunnel -> uji publik. */
async function pasang(s) {
  const cek = await sumberHidup(s);
  if (!cek.hidup) {
    catat('  ' + s.toko.padEnd(4) + ' LEWATI — sumber ' + s.sumber + ' tidak hidup (' + cek.alasan + ')');
    return { ok: false, alasan: 'sumber mati: ' + cek.alasan, url: null, proses: null };
  }

  catat('  ' + s.toko.padEnd(4) + ' sumber hidup (items=' + cek.items + '). Membuat tunnel…');
  const t = buatTunnel(s);
  const url = await tungguUrl(t.logFile, 90);
  if (!url) {
    try { t.anak.kill(); } catch (_) { /* abaikan */ }
    catat('  ' + s.toko.padEnd(4) + ' GAGAL — tunnel tidak memberi URL (log: ' + t.logFile + ')');
    return { ok: false, alasan: 'tunnel tanpa URL', url: null, proses: null };
  }

  // Uji lewat internet (bukan lewat lokal) — persis seperti Railway.
  const kunci = kunciUntuk(s.kunciEnv);
  for (let coba = 1; coba <= 10; coba++) {
    try {
      const h = await ambilJson(url + '/ipos/health', kunci, 15000);
      if (h.status === 200 && h.j && h.j.ok) {
        catat('  ' + s.toko.padEnd(4) + ' SIAP ' + url + ' (items=' + h.j.items + ')');
        return { ok: true, url, proses: t.anak, logFile: t.logFile };
      }
      if (coba === 10) throw new Error('HTTP ' + h.status);
    } catch (e) {
      if (coba === 10) {
        try { t.anak.kill(); } catch (_) { /* abaikan */ }
        catat('  ' + s.toko.padEnd(4) + ' GAGAL — uji publik: ' + String(e.message).slice(0, 80));
        return { ok: false, alasan: 'uji publik gagal', url: null, proses: null };
      }
    }
    await tidur(2000);
  }
  return { ok: false, alasan: 'tidak terduga', url: null, proses: null };
}

// -------------------------------------------------------------- variabel Railway
function bacaVariabelRailway() {
  try {
    const out = execFileSync(process.execPath, [CLI, 'variables', '--service', SERVICE, '--json'], {
      cwd: ROOT, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(out);
  } catch (e) {
    catat('  ! gagal membaca variabel Railway: ' + String(e.stderr || e.message).split('\n')[0].slice(0, 120));
    return null;
  }
}

function setVariabelRailway(nama, nilai) {
  try {
    execFileSync(process.execPath, [CLI, 'variables', '--service', SERVICE, '--set', nama + '=' + nilai], {
      cwd: ROOT, timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    catat('  variabel ' + nama + ' diperbarui');
    return true;
  } catch (e) {
    catat('  ! gagal set ' + nama + ': ' + String(e.stderr || e.message).split('\n')[0].slice(0, 120));
    return false;
  }
}

/** Railway otomatis redeploy saat variabel berubah; kalau tidak, paksa `up`. */
async function pastikanRailwayMemakai(harapan) {
  const batas = Date.now() + TENGGANG_DEPLOY;
  let paksa = false;
  while (Date.now() < batas) {
    await tidur(15000);
    try {
      const h = await ambilJson(DOMAIN + '/health', null, 30000);
      if (h.status === 200 && h.j && h.j.ipos) {
        const cocok = Object.keys(harapan).every((tk) => {
          const s = h.j.ipos[tk];
          return s && s.online === true;
        });
        if (cocok) { catat('  Railway sudah memakai URL baru (semua toko online)'); return true; }
        catat('  menunggu Railway… ' + Object.keys(harapan).map((tk) => {
          const s = h.j.ipos[tk] || {};
          return tk + '=' + (s.online ? 'online' : 'offline');
        }).join(' '));
      }
    } catch (_) { /* bot mungkin sedang restart */ }

    if (!paksa && Date.now() > batas - TENGGANG_DEPLOY / 2) {
      paksa = true;
      catat('  variabel berubah tapi Railway belum online -> paksa deploy');
      try {
        execFileSync(process.execPath, [CLI, 'up', '--ci', '--service', SERVICE], {
          cwd: ROOT, timeout: 1800000, stdio: ['ignore', 'pipe', 'pipe'],
        });
        catat('  deploy dipaksa selesai');
      } catch (e) {
        catat('  ! deploy paksa gagal: ' + String(e.stderr || e.message).split('\n')[0].slice(0, 120));
      }
    }
  }
  catat('  ! Railway belum memakai URL baru dalam ' + Math.round(TENGGANG_DEPLOY / 60000) + ' menit');
  return false;
}

// --------------------------------------------------------------------- siklus
/** Pastikan satu sasaran punya tunnel hidup + URL Railway yang cocok. */
async function jagaSatu(s, vars) {
  const st = status.sasaran[s.toko] || (status.sasaran[s.toko] = {});
  st.nama = s.nama;
  st.sumber = s.sumber;

  const sumber = await sumberHidup(s);
  st.sumberHidup = sumber.hidup;
  st.sumberAlasan = sumber.alasan || null;
  if (!sumber.hidup) {
    // Sumber mati: matikan tunnel lama agar tidak jadi sampah, jangan sentuh Railway.
    const lama = prosesAktif.get(s.toko);
    if (lama) { try { lama.kill(); } catch (_) { /* abaikan */ } prosesAktif.delete(s.toko); }
    st.url = null;
    st.keadaan = 'sumber-mati';
    st.alasan = sumber.alasan;
    return null;
  }

  // Tunnel hidup dan masih melayani?
  const prosesLama = prosesAktif.get(s.toko);
  if (prosesLama && st.url) {
    const masih = prosesLama.exitCode === null && !prosesLama.killed;
    if (masih) {
      try {
        const h = await ambilJson(st.url + '/ipos/health', kunciUntuk(s.kunciEnv), 15000);
        if (h.status === 200 && h.j && h.j.ok) {
          st.keadaan = 'sehat';
          st.alasan = null;
          st.terakhirSehat = new Date().toISOString();
          // URL di Railway sudah benar?
          const dipakai = vars ? vars[s.nama] : null;
          if (dipakai && dipakai !== st.url + '/ipos') {
            st.keadaan = 'url-beda';
            return { nama: s.nama, url: st.url };
          }
          return null;
        }
        st.alasan = 'uji publik HTTP ' + h.status;
      } catch (e) {
        st.alasan = (e.cause && e.cause.code) || String(e.message).slice(0, 60);
      }
      catat('  ' + s.toko.padEnd(4) + ' tunnel tidak sehat (' + st.alasan + ') -> dibuat ulang');
    }
    try { prosesLama.kill(); } catch (_) { /* abaikan */ }
    prosesAktif.delete(s.toko);
    st.url = null;
  }

  // Pasang baru.
  const hasil = await pasang(s);
  if (!hasil.ok) {
    st.keadaan = 'gagal';
    st.alasan = hasil.alasan;
    return null;
  }
  st.url = hasil.url;
  prosesAktif.set(s.toko, hasil.proses);
  st.pidTunnel = hasil.proses ? hasil.proses.pid : null;
  st.logFile = hasil.logFile;
  st.keadaan = 'sehat';
  st.alasan = null;
  st.terakhirPasang = new Date().toISOString();
  st.terakhirSehat = st.terakhirPasang;

  const dipakai = vars ? vars[s.nama] : null;
  if (dipakai === st.url + '/ipos') {
    catat('  ' + s.toko.padEnd(4) + ' URL Railway sudah sama — tidak diubah');
    return null;
  }
  return { nama: s.nama, url: st.url };
}

async function siklus() {
  status.siklus++;
  catat('=== siklus ' + status.siklus + ' ===');
  const vars = bacaVariabelRailway();
  if (!vars) {
    // Tanpa daftar variabel kita tidak tahu URL mana yang sedang dipakai.
    // Menulis buta akan memicu redeploy setiap siklus -> bot restart terus.
    catat('! tidak bisa membaca variabel Railway — siklus ini hanya memantau, tidak mengubah');
    tulisStatus();
    return;
  }
  const perlu = {};
  const harapan = {};

  for (const s of SASARAN) {
    const ubah = await jagaSatu(s, vars);
    if (ubah) {
      perlu[ubah.nama] = ubah.url;
      // HANYA toko yang URL-nya benar-benar diubah yang boleh ditunggu.
      // Toko yang sumbernya mati (mis. CP/NK saat listrik padam) tidak akan
      // pernah online; menunggunya hanya membuang waktu 6 menit.
      harapan[s.toko.toLowerCase()] = true;
    }
  }

  const nama = Object.keys(perlu);
  if (!nama.length) {
    catat('tidak ada URL yang perlu diubah');
  } else {
    let ada = false;
    for (const n of nama) {
      if (setVariabelRailway(n, perlu[n] + '/ipos')) ada = true;
    }
    if (ada) await pastikanRailwayMemakai(harapan);
  }
  tulisStatus();
}

// ---------------------------------------------------------------------- main
(async () => {
  if (!fs.existsSync(CF)) {
    console.error('cloudflared.exe tidak ada di ' + CF);
    process.exit(1);
  }
  const lock = ambilLock();
  if (!lock.ok) {
    console.error('SUDAH ADA pengawas tunnel berjalan (pid ' + lock.pid + '). Keluar agar tidak dobel.');
    process.exit(2);
  }
  process.on('exit', lepasLock);
  process.on('SIGINT', () => { lepasLock(); process.exit(0); });
  process.on('SIGTERM', () => { lepasLock(); process.exit(0); });

  catat('pengawas tunnel mulai (pid ' + process.pid + ')');
  catat('CATATAN: tunnel quick Cloudflare TIDAK dijamin 24/7. Ini jaring sementara.');
  catat('Jalur permanen: pasang Tailscale userspace di container Railway (butuh TS_AUTHKEY).');
  tulisStatus();

  // putaran tanpa akhir
  for (;;) {
    try {
      await siklus();
    } catch (e) {
      catat('! siklus gagal: ' + String(e && e.message).slice(0, 200));
    }
    await tidur(JEDA_PERIKSA);
  }
})().catch((e) => {
  console.error('FATAL: ' + (e && e.message));
  lepasLock();
  process.exit(1);
});

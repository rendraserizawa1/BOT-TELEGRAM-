'use strict';

// ════════════════════════════════════════════════════════════════
//   KUNCI SINGLE-INSTANCE BOT (modul terpisah agar bisa diuji)
//
//   KENAPA MODUL INI ADA
//   --------------------
//   Versi lama menyimpan PID mentah di storage\bot.lock lalu memakai
//   process.kill(pid, 0) untuk menebak "hidup/mati". Di Windows PID cepat
//   didaur ulang dan proses milik user lain menghasilkan EPERM, sehingga
//   lock basi dianggap HIDUP selamanya.
//
//   Akibat nyata (2026-11-14): bot tidak membalas chat sama sekali.
//   Lock berisi pid 8928 (bot lama, sudah mati). PID 8928 dipakai ulang
//   oleh SecurityHealthService.exe. Setiap instance baru membaca lock,
//   menyimpulkan "instance lain masih hidup", lalu process.exit(2).
//   Wrapper berhenti pada exit=2 dan watchdog me-restart sia-sia tiap
//   ~3 menit -> nol poller getUpdates, port 3001 tidak pernah listen.
//
//   PRINSIP PERBAIKAN
//   -----------------
//   1. PID saja tidak pernah cukup: verifikasi IDENTITAS proses
//      (harus node.exe, command line harus memuat index.js, dan waktu
//      pembuatan proses tidak boleh lebih muda daripada isi lock).
//   2. Kalau identitas tidak bisa dipastikan (alat gagal), JANGAN keluar.
//      bind() port dashboard bersifat atomik, jadi port 3001 tetap menjadi
//      wasit terakhir dan poller dijaga flag webServerListening.
//   3. Lapis cadangan: PID node kita yang hidup tetapi tidak memegang
//      port dashboard = proses mati suri -> lock boleh diambil alih.
//   4. Tidak pernah melakukan bind/probe port di sini. Probe bind pernah
//      memicu EADDRINUSE palsu; netstat hanya membaca tabel socket.
// ════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const LOCK_FILE_DEFAULT = path.join(__dirname, 'storage', 'bot.lock');
const PORT_DEFAULT = Number(process.env.PORT || 3001);

// Berapa lama proses node yang memegang lock boleh belum listen port sebelum
// dianggap mati suri. Host ini lambat (startup pernah 210 detik karena pagefile
// thrash), jadi beri kelonggaran lebar. bind() tetap wasit terakhir.
const STARTUP_GRACE_MS = Number(process.env.BOT_LOCK_STARTUP_GRACE_MS || 180000);

function jalankanAlat(exe, args) {
  try {
    return String(childProcess.execFileSync(exe, args, {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    }) || '');
  } catch (e) {
    return '';
  }
}

function pidAlive(pid) {
  if (!pid || pid === process.pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return !!(e && e.code === 'EPERM'); }
}

function infoProses(pid) {
  if (!pid) return null;
  const out = jalankanAlat('wmic', [
    'process', 'where', 'processid=' + pid, 'get',
    'Name,CommandLine,CreationDate', '/format:list'
  ]);
  if (!out) return null;
  const info = {};
  for (const baris of out.split(/\r?\n/)) {
    const i = baris.indexOf('=');
    if (i <= 0) continue;
    const k = baris.slice(0, i).trim();
    if (k) info[k] = baris.slice(i + 1).trim();
  }
  return info.Name ? info : null;
}

// true jika PID memegang port dashboard pada state LISTENING.
// Membaca netstat, bukan bind -> tidak bisa memicu EADDRINUSE.
function portDipegang(pid, port) {
  if (!pid) return false;
  const out = jalankanAlat('netstat', ['-ano', '-p', 'TCP']);
  if (!out) return false;
  const re = new RegExp(':' + port + '\\s+\\S+\\s+LISTENING\\s+' + pid + '(?![0-9])');
  return re.test(out);
}

function waktuBuatProses(creationDate) {
  const m = String(creationDate || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  const ms = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// true  = PID itu benar-benar instance bot kita -> lock masih sah
// false = pasti basi (PID didaur ulang / bukan bot kita)
// null  = tidak bisa dipastikan (alat identitas gagal)
//
// BUKTI KEPEMILIKAN YANG SAH = PID hidup sebagai node.exe DAN memegang
// port dashboard (mutex atomik OS). Command line TIDAK dipakai sebagai
// syarat: saat bot dijalankan PM2, process yang sebenarnya adalah
// node ...\pm2\lib\ProcessContainerFork.js sehingga teks "index.js"
// tidak muncul. Menjadikannya syarat membuat instance sehat dianggap
// basi -> lock diambil alih -> berisiko poller ganda/409.
function pemilikLockSah(pid, lockAtMs, port, deps) {
  const d = deps || {};
  const alive = d.pidAlive ? d.pidAlive(pid) : pidAlive(pid);
  if (!alive) return false;

  const info = (d.infoProses ? d.infoProses(pid) : infoProses(pid));
  if (!info) return null;

  // Proses bernama lain memakai PID ini = PID daur ulang (bug produksi).
  if (String(info.Name).toLowerCase() !== 'node.exe') return false;

  // Lock ditulis tepat saat pemiliknya mulai. PID daur ulang berarti proses
  // yang memakai PID itu jauh LEBIH MUDA daripada isi lock.
  const buat = waktuBuatProses(info.CreationDate);
  if (buat && lockAtMs && buat > lockAtMs + 120000) return false;

  // Syarat utama: benar-benar memegang port dashboard. Proses node yang
  // hidup tetapi tidak memegang port = mati suri / bukan instance utama.
  const pegang = d.portDipegang ? d.portDipegang(pid) : portDipegang(pid, port);
  if (pegang) return true;

  // MASA TENGGANG STARTUP: proses node hidup dengan lock yang masih SANGAT
  // BARU mungkin sedang boot dan belum sempat listen. Menilainya basi akan
  // membuat instance kedua merebut lock. bind() port tetap wasit terakhir,
  // tetapi lebih baik tidak menimbulkan kebingungan sama sekali.
  const umurLockMs = lockAtMs ? (Date.now() - lockAtMs) : Infinity;
  if (umurLockMs >= 0 && umurLockMs < STARTUP_GRACE_MS) return true;

  return false;
}

function acquire(opts) {
  const o = opts || {};
  const lockFile = o.lockFile || LOCK_FILE_DEFAULT;
  const port = Number(o.port || PORT_DEFAULT);
  const deps = o.deps || {};
  const log = o.log || function () {};

  const payload = JSON.stringify({ pid: process.pid, at: Date.now(), port });
  try { fs.mkdirSync(path.dirname(lockFile), { recursive: true }); } catch (e) {}

  try {
    fs.writeFileSync(lockFile, payload, { flag: 'wx' });
    return true;
  } catch (e) {
    // Masalah lock tidak boleh memblokir start.
    if (!e || e.code !== 'EEXIST') return true;
  }

  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(lockFile, 'utf8')); } catch (e) {}
  const prevPid = prev && Number(prev.pid);
  const prevAt = prev && Number(prev.at);

  if (prevPid && prevPid !== process.pid) {
    const hasil = pemilikLockSah(prevPid, prevAt, port, deps);
    if (hasil === true) {
      log(`🛑 Instance lain masih hidup (PID ${prevPid}, port ${port}). Proses ini keluar (cegah poller ganda/409).`);
      return false;
    }
    if (hasil === null) {
      log(`⚠️  Identitas PID ${prevPid} tidak bisa dipastikan; lanjut, port ${port} yang memutuskan.`);
    } else {
      log(`♻️  Lock basi (PID ${prevPid} bukan bot kita); diambil alih.`);
    }
  }

  try { fs.writeFileSync(lockFile, payload); } catch (e) {}
  return true;
}

function release(opts) {
  const o = opts || {};
  const lockFile = o.lockFile || LOCK_FILE_DEFAULT;
  try {
    const cur = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    if (Number(cur.pid) === process.pid) fs.unlinkSync(lockFile);
  } catch (e) {}
}

module.exports = {
  LOCK_FILE_DEFAULT,
  PORT_DEFAULT,
  STARTUP_GRACE_MS,
  pidAlive,
  infoProses,
  portDipegang,
  waktuBuatProses,
  pemilikLockSah,
  acquire,
  release
};

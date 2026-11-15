'use strict';
/**
 * PENJAGA POLLER TUNGGAL — memastikan hanya SATU bot Telegram yang berjalan.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * 2026-11-15 log PM2 lokal membuktikan dua poller berebut token yang sama:
 *
 *   [WARN] [POLLING] 409 Conflict (1x) - tunggu 30 dtk agar poller lama lepas
 *   (berulang tiap ~30 detik, 14:00 -> 14:08)
 *
 * Penyebabnya: entri registry HKCU `PM2` menjalankan
 * `boot/start-bot-if-needed.ps1`, yang me-resurrect `telegram-perabot`
 * (script `C:\BOT-TELEGRAM-\index.js`, 212 restart). Scheduled task
 * `BCODE-KEFA-BOT` memang `Disabled`, tetapi PM2 sama sekali tidak
 * memeriksa task itu. Bot lokal dan bot Railway lalu saling menendang.
 *
 * Bot di Railway punya kunci sendiri (bot-instance-lock.js untuk Windows,
 * boot/replika-guard.js untuk POSIX). Kunci itu TIDAK bisa mencegah mesin
 * lain (PC ini) ikut polling. Karena itu penjagaan harus di tingkat mesin.
 *
 * YANG DIJAGA BERKAS INI
 * ----------------------
 *   1. Tidak ada proses `node ... BOT-TELEGRAM-\index.js` yang hidup.
 *   2. Tidak ada yang mendengarkan port 3001 (port bot lokal).
 *   3. PM2 tidak punya aplikasi `telegram-perabot`.
 *   4. Entri registry HKCU/HKLM `PM2` (autostart) tidak ada.
 *   5. Scheduled task BCODE-KEFA-BOT / BCODE-KEFA-WATCHDOG tetap Disabled.
 *   6. Melaporkan apakah Railway benar-benar satu-satunya poller.
 *
 * YANG TIDAK DISENTUH (PENTING)
 * -----------------------------
 *   - Proxy iPos KEFA (`C:\Users\rdpadmin\ipos-api\server.js`, port 8080)
 *     TIDAK PERNAH dibunuh. Itu sumber data, bukan bot.
 *   - `cloudflared` / boot/jaga-tunnel.js TIDAK disentuh.
 *   - Tailscale TIDAK disentuh.
 *
 * Pemakaian:  node boot\jaga-poller-tunggal.js
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOCK = path.join(__dirname, '.jaga-poller.lock');
const STATUS = path.join(__dirname, 'poller-status.json');
const DOMAIN = 'https://kefa-bot-production.up.railway.app';
const PM2 = 'C:\\Users\\rdpadmin\\AppData\\Roaming\\npm\\pm2.cmd';

// Port bot lokal. Proxy iPos memakai 8080 — JANGAN pernah masuk daftar ini.
const PORT_BOT_LOKAL = 3001;
const PORT_PROXY_IPOS = 8080;

const JEDA = 30 * 1000;
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
const jam = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const catat = (...a) => console.log('[' + jam() + ']', ...a);

const status = { mulai: new Date().toISOString(), pid: process.pid, siklus: 0, temuan: [], tindakan: [] };
function tulisStatus() {
  status.diperbarui = new Date().toISOString();
  try { fs.writeFileSync(STATUS, JSON.stringify(status, null, 2), 'utf8'); } catch (_) { /* abaikan */ }
}
function tambah(bucket, isi) {
  status[bucket].push({ waktu: new Date().toISOString(), ...isi });
  if (status[bucket].length > 200) status[bucket].splice(0, status[bucket].length - 200);
}

// ---------------------------------------------------------------- lock sendiri
function ambilLock() {
  try {
    if (fs.existsSync(LOCK)) {
      const isi = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
      if (isi.pid && isi.pid !== process.pid) {
        try { process.kill(isi.pid, 0); return { ok: false, pid: isi.pid }; } catch (_) { /* mati */ }
      }
    }
  } catch (_) { /* lock rusak */ }
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

// ------------------------------------------------------------------- PowerShell
/** Jalankan skrip PowerShell, kembalikan stdout sebagai teks. */
function ps(skrip) {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', skrip], {
      encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
  } catch (e) {
    return (e.stdout || '') + '\n' + (e.stderr || '');
  }
}

/**
 * Cari proses node yang menjalankan bot. Pencocokan HARUS menyebut
 * `BOT-TELEGRAM-` DAN `index.js`, dan TIDAK boleh menyebut `ipos-api`.
 */
function cariBotLokal() {
  const out = ps(
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
    'Where-Object { $_.CommandLine -match \'BOT-TELEGRAM\' -and $_.CommandLine -match \'index\\.js\' -and $_.CommandLine -notmatch \'ipos-api\' } | ' +
    'ForEach-Object { $_.ProcessId.ToString() + "|" + $_.CommandLine }'
  );
  const hasil = [];
  for (const baris of out.split(/\r?\n/)) {
    const t = baris.trim();
    if (!t || !t.includes('|')) continue;
    const i = t.indexOf('|');
    const pid = parseInt(t.slice(0, i), 10);
    if (!Number.isFinite(pid) || pid === process.pid) continue;
    hasil.push({ pid, cmd: t.slice(i + 1).slice(0, 220) });
  }
  return hasil;
}

/** Apakah ada yang mendengarkan port bot lokal? */
function pendengarPort(port) {
  const out = ps(
    'Get-NetTCPConnection -LocalPort ' + port + ' -State Listen -ErrorAction SilentlyContinue | ' +
    'ForEach-Object { $_.OwningProcess.ToString() }'
  );
  const pids = [];
  for (const baris of out.split(/\r?\n/)) {
    const n = parseInt(baris.trim(), 10);
    if (Number.isFinite(n) && n > 0) pids.push(n);
  }
  return [...new Set(pids)];
}

/** Bunuh satu PID, dan laporkan apakah benar-benar mati. */
function bunuh(pid, alasan) {
  ps('try { Stop-Process -Id ' + pid + ' -Force -ErrorAction Stop; "OK" } catch { "GAGAL: " + $_.Exception.Message }');
  const masih = cariBotLokal().some((p) => p.pid === pid);
  catat('  PID ' + pid + ' dibunuh (' + alasan + ') -> ' + (masih ? 'MASIH HIDUP' : 'mati'));
  tambah('tindakan', { jenis: 'bunuh-proses', pid, alasan, berhasil: !masih });
  return !masih;
}

// ---------------------------------------------------------------- PM2 & task
function pm2Daftar() {
  try {
    const out = execFileSync('cmd.exe', ['/c', '"' + PM2 + '" jlist'], {
      encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    const mulai = out.indexOf('[');
    if (mulai < 0) return [];
    return JSON.parse(out.slice(mulai));
  } catch (_) {
    return [];
  }
}

function pm2Bersihkan() {
  const daftar = pm2Daftar();
  const nakal = daftar.filter((a) => a && a.name === 'telegram-perabot');
  if (!nakal.length) return false;
  catat('  PM2 masih memuat telegram-perabot (' + nakal.length + ') -> dihapus');
  try {
    execFileSync('cmd.exe', ['/c', '"' + PM2 + '" delete telegram-perabot'], {
      timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    execFileSync('cmd.exe', ['/c', '"' + PM2 + '" save --force'], {
      timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    tambah('tindakan', { jenis: 'pm2-hapus', aplikasi: 'telegram-perabot' });
    return true;
  } catch (e) {
    catat('  ! gagal hapus PM2: ' + String(e.message).slice(0, 120));
    return false;
  }
}

function registryBersihkan() {
  let ada = false;
  for (const k of ['HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run']) {
    const out = ps('if (Test-Path \'' + k + '\') { (Get-ItemProperty \'' + k + '\').PSObject.Properties.Name -join "," }');
    if (out.split(',').map((s) => s.trim()).includes('PM2')) {
      ps('Remove-ItemProperty -Path \'' + k + '\' -Name \'PM2\' -Force -ErrorAction SilentlyContinue');
      catat('  entri autostart PM2 dihapus dari ' + k.split('\\')[0]);
      tambah('tindakan', { jenis: 'hapus-registry', kunci: k, nama: 'PM2' });
      ada = true;
    }
  }
  return ada;
}

function taskBersihkan() {
  let ada = false;
  for (const n of ['BCODE-KEFA-BOT', 'BCODE-KEFA-WATCHDOG']) {
    const out = ps('$t = Get-ScheduledTask -TaskName \'' + n + '\' -ErrorAction SilentlyContinue; if ($t) { $t.State } else { "TIDAK-ADA" }');
    const s = out.trim();
    if (s && s !== 'TIDAK-ADA' && s !== 'Disabled') {
      ps('Disable-ScheduledTask -TaskName \'' + n + '\' -ErrorAction SilentlyContinue | Out-Null');
      catat('  task ' + n + ' state=' + s + ' -> Disabled');
      tambah('tindakan', { jenis: 'disable-task', task: n, dari: s });
      ada = true;
    }
  }
  return ada;
}

// ---------------------------------------------------------------- cek Railway
async function cekRailway() {
  try {
    const r = await fetch(DOMAIN + '/health', { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return { ok: false, alasan: 'HTTP ' + r.status };
    const j = await r.json();
    return {
      ok: true,
      status: j.status,
      polling: j.polling,
      streak: j.telegramPollErrorStreak,
      uptime: j.uptime,
      // streak > 0 = ada poller lain. Ini alarm utama.
      konflik: Number(j.telegramPollErrorStreak) > 0,
    };
  } catch (e) {
    return { ok: false, alasan: (e.cause && e.cause.code) || String(e.message).slice(0, 80) };
  }
}

// -------------------------------------------------------------------- siklus
async function siklus() {
  status.siklus++;
  catat('=== siklus ' + status.siklus + ' ===');
  let berubah = false;

  // 1. Proses bot lokal.
  const bot = cariBotLokal();
  if (bot.length) {
    catat('  DITEMUKAN ' + bot.length + ' bot lokal (seharusnya 0):');
    bot.forEach((b) => catat('    pid=' + b.pid + ' ' + b.cmd));
    tambah('temuan', { jenis: 'bot-lokal', jumlah: bot.length, pids: bot.map((b) => b.pid) });
    for (const b of bot) bunuh(b.pid, 'bot lokal harus mati; poller tunggal ada di Railway');
    berubah = true;
  } else {
    catat('  bot lokal: tidak ada (benar)');
  }

  // 2. Port bot lokal.
  const pend = pendengarPort(PORT_BOT_LOKAL);
  if (pend.length) {
    catat('  port ' + PORT_BOT_LOKAL + ' didengarkan pid=' + pend.join(',') + ' -> dibunuh');
    tambah('temuan', { jenis: 'port-bot-terbuka', port: PORT_BOT_LOKAL, pids: pend });
    for (const p of pend) {
      // Jangan pernah menyentuh proxy iPos.
      if (p === pendengarPort(PORT_PROXY_IPOS)[0]) continue;
      bunuh(p, 'port ' + PORT_BOT_LOKAL + ' milik bot lokal');
    }
    berubah = true;
  } else {
    catat('  port ' + PORT_BOT_LOKAL + ': bebas (benar)');
  }

  // 3. PM2.
  if (pm2Bersihkan()) berubah = true;

  // 4. Registry autostart.
  if (registryBersihkan()) berubah = true;

  // 5. Scheduled task.
  if (taskBersihkan()) berubah = true;

  // 6. Proxy iPos HARUS tetap hidup (bukti tidak salah bunuh).
  const proxy = pendengarPort(PORT_PROXY_IPOS);
  status.proxyIpos = proxy.length ? { hidup: true, pids: proxy } : { hidup: false };
  catat('  proxy iPos :' + PORT_PROXY_IPOS + ' ' + (proxy.length ? 'hidup pid=' + proxy.join(',') + ' (tidak disentuh)' : 'MATI — perlu diperiksa'));

  // 7. Railway satu-satunya poller?
  const rw = await cekRailway();
  status.railway = rw;
  if (!rw.ok) {
    catat('  Railway /health: GAGAL (' + rw.alasan + ')');
  } else if (rw.konflik) {
    catat('  ! PERINGATAN: Railway streak=' + rw.streak + ' -> masih ada poller lain di luar kendali mesin ini');
    catat('    (bisa instance lain di jaringan/HP/VPS lain yang memakai token sama)');
    tambah('temuan', { jenis: 'railway-streak', streak: rw.streak });
  } else {
    catat('  Railway: polling=' + rw.polling + ' streak=' + rw.streak + ' (satu poller, benar)');
  }

  if (berubah) catat('  -> ada tindakan perbaikan siklus ini');
  tulisStatus();
}

// ----------------------------------------------------------------------- main
(async () => {
  const lock = ambilLock();
  if (!lock.ok) {
    console.error('SUDAH ADA penjaga poller berjalan (pid ' + lock.pid + '). Keluar agar tidak dobel.');
    process.exit(2);
  }
  process.on('exit', lepasLock);
  process.on('SIGINT', () => { lepasLock(); process.exit(0); });
  process.on('SIGTERM', () => { lepasLock(); process.exit(0); });

  catat('penjaga poller tunggal mulai (pid ' + process.pid + ')');
  catat('bot yang SAH hanya satu: Railway ' + DOMAIN);
  tulisStatus();

  for (;;) {
    try {
      await siklus();
    } catch (e) {
      catat('! siklus gagal: ' + String(e && e.message).slice(0, 200));
    }
    await tidur(JEDA);
  }
})().catch((e) => {
  console.error('FATAL: ' + (e && e.message));
  lepasLock();
  process.exit(1);
});

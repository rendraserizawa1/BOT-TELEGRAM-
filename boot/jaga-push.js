'use strict';
/**
 * PENJAGA AGEN DORONG — memastikan agen dorong iPos hidup terus di PC.
 *
 * KENAPA PERLU PENJAGA
 * --------------------
 * Arsitektur dorong tidak punya "sambungan yang harus dijaga", tetapi ia
 * punya satu titik lemah: proses agennya sendiri. Kalau proses itu mati
 * (PC restart, node crash, memori habis), data berhenti mengalir TANPA suara —
 * persis kegagalan yang paling sulit dilacak.
 *
 * Penjaga ini:
 *   1. memeriksa agen tiap 20 detik
 *   2. menyalakannya lagi bila mati
 *   3. memastikan HANYA SATU agen berjalan (dua agen = kiriman ganda)
 *   4. memeriksa kesegaran data di SERVER, bukan hanya proses lokal hidup
 *
 * Poin 4 yang paling penting: proses "hidup" belum tentu "mengirim". Bisa saja
 * agen jalan tetapi token salah, atau PC tidak bisa menjangkau Railway. Penjaga
 * menanyakan /health server dan memeriksa `push.<toko>.items.umurDetik`.
 *
 * Pemakaian: node boot\jaga-push.js
 */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const AGEN = path.join(__dirname, 'push-agen.js');
const LOCK = path.join(__dirname, '.jaga-push.lock');
const STATUS = path.join(__dirname, 'jaga-push-status.json');
const LOG_AGEN = path.join(__dirname, 'push-agen.log');

const DOMAIN = String(process.env.PUSH_URL || 'https://kefa-bot-production.up.railway.app').replace(/\/+$/, '');
const JEDA = Number(process.env.JAGA_PUSH_JEDA_MS || 20000);
// Data dianggap berhenti mengalir bila umur katalog melewati ini. Dua kali
// jeda katalog penuh (15 menit) + kelonggaran: kalau PC sehat, katalog penuh
// atau delta pasti sudah memperbarui umur jauh sebelum batas ini.
const BATAS_BASI_DETIK = Number(process.env.JAGA_PUSH_BASI_DETIK || 1800);

const jam = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const catat = (...a) => console.log('[' + jam() + ']', ...a);
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));

const status = {
  mulai: new Date().toISOString(), pid: process.pid, siklus: 0,
  agenPid: null, agenMulai: null, jumlahRestart: 0,
  temuan: [], tindakan: [],
};
function tulisStatus() {
  status.diperbarui = new Date().toISOString();
  try { fs.writeFileSync(STATUS, JSON.stringify(status, null, 2), 'utf8'); } catch (_) { /* abaikan */ }
}
function tambah(bucket, isi) {
  status[bucket].push({ waktu: new Date().toISOString(), ...isi });
  if (status[bucket].length > 200) status[bucket].splice(0, status[bucket].length - 200);
}

// ── KUNCI PENJAGA (satu penjaga saja) ────────────────────────────────────
function pidHidup(pid) {
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}
function ambilLock() {
  try {
    if (fs.existsSync(LOCK)) {
      const isi = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
      if (isi && isi.pid && isi.pid !== process.pid && pidHidup(isi.pid)) {
        console.error('[JAGA-PUSH] penjaga lain sudah berjalan (pid ' + isi.pid + ') - keluar');
        process.exit(2);
      }
    }
  } catch (_) { /* lock rusak */ }
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

// ── CARI AGEN YANG SUDAH BERJALAN ────────────────────────────────────────
/**
 * Mencari proses node yang menjalankan push-agen.js.
 * Pencocokan WAJIB menyebut `push-agen.js` supaya proses lain tidak ikut
 * terhitung — dan TIDAK boleh menyebut `jaga-push` (itu penjaga ini sendiri).
 */
function cariAgen() {
  let out = '';
  try {
    out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | ' +
      'Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress',
    ], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
  }
  let daftar = [];
  try {
    const j = JSON.parse(String(out).trim() || '[]');
    daftar = Array.isArray(j) ? j : [j];
  } catch (_) {
    return [];
  }
  return daftar.filter((p) => {
    const c = String(p.CommandLine || '');
    if (!c.includes('push-agen.js')) return false;
    if (c.includes('jaga-push.js')) return false;
    return true;
  }).map((p) => Number(p.ProcessId)).filter((n) => Number.isFinite(n) && n > 0);
}

// ── NYALAKAN AGEN ────────────────────────────────────────────────────────
let prosesAgen = null;

function nyalakanAgen() {
  const log = fs.createWriteStream(LOG_AGEN, { flags: 'a' });
  log.write('\n=== agen dinyalakan ' + new Date().toISOString() + ' ===\n');
  const anak = spawn(process.execPath, [AGEN], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  anak.stdout.pipe(log);
  anak.stderr.pipe(log);
  anak.on('exit', (kode) => {
    catat('agen keluar dengan kode ' + kode);
    tambah('temuan', { agenKeluar: kode });
    prosesAgen = null;
  });
  prosesAgen = anak;
  status.agenPid = anak.pid;
  status.agenMulai = new Date().toISOString();
  tambah('tindakan', { nyalakanAgen: anak.pid });
  catat('agen dinyalakan pid=' + anak.pid);
  return anak.pid;
}

// ── PERIKSA KESEGARAN DI SERVER ──────────────────────────────────────────
/**
 * Menanyakan /health SERVER. Ini bukti sebenarnya: proses lokal bisa hidup
 * tetapi tidak mengirim apa pun (token salah, jaringan putus).
 */
async function periksaServer() {
  try {
    const r = await fetch(DOMAIN + '/health', { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return { ok: false, alasan: 'HTTP ' + r.status };
    const h = await r.json();
    const p = h && h.push;
    if (!p || !p.aktif) return { ok: false, alasan: 'PUSH_TOKEN belum aktif di server' };
    const hasil = {};
    for (const toko of ['cp', 'nk', 'kefa']) {
      const it = p[toko] && p[toko].items;
      if (!it) { hasil[toko] = { ada: false }; continue; }
      const umur = Number(it.umurDetik);
      hasil[toko] = { ada: true, umur, basi: umur > BATAS_BASI_DETIK, total: it.total };
    }
    return { ok: true, hasil };
  } catch (e) {
    return { ok: false, alasan: (e && e.message) || String(e) };
  }
}

// ── JALAN ────────────────────────────────────────────────────────────────
(async () => {
  ambilLock();
  process.on('exit', lepasLock);
  process.on('SIGINT', () => { lepasLock(); process.exit(0); });
  process.on('SIGTERM', () => { lepasLock(); process.exit(0); });

  catat('penjaga agen dorong mulai; server=' + DOMAIN);
  tulisStatus();

  for (;;) {
    status.siklus++;
    try {
      const agen = cariAgen();
      if (agen.length === 0) {
        tambah('temuan', { agenHilang: true });
        nyalakanAgen();
        status.jumlahRestart++;
      } else if (agen.length > 1) {
        // LEBIH DARI SATU = kiriman ganda. Matikan yang lebih baru, sisakan satu.
        tambah('temuan', { agenGanda: agen });
        const urut = [...agen].sort((a, b) => a - b);
        for (const pid of urut.slice(1)) {
          try { process.kill(pid); tambah('tindakan', { matikanAgenGanda: pid }); } catch (_) { /* sudah mati */ }
        }
        status.agenPid = urut[0];
      } else {
        status.agenPid = agen[0];
      }

      // Periksa server: proses hidup != data mengalir.
      const srv = await periksaServer();
      if (!srv.ok) {
        tambah('temuan', { server: srv.alasan });
        catat('server: ' + srv.alasan);
      } else {
        for (const [toko, v] of Object.entries(srv.hasil)) {
          if (!v.ada) continue;
          if (v.basi) {
            tambah('temuan', { toko, basiDetik: v.umur });
            catat(toko + ': data BASI ' + v.umur + ' dtk (total=' + v.total + ')');
          }
        }
      }
    } catch (e) {
      tambah('temuan', { error: String((e && e.message) || e).slice(0, 200) });
    }
    tulisStatus();
    await tidur(JEDA);
  }
})().catch((e) => {
  console.error('[JAGA-PUSH] FATAL: ' + ((e && e.stack) || e));
  lepasLock();
  process.exit(1);
});

'use strict';
/**
 * PENSIUNKAN PENGAWAS TUNNEL — hanya boleh dijalankan SETELAH Tailscale
 * terbukti bekerja di Railway.
 *
 * KENAPA HARUS DIPENSIUNKAN
 * -------------------------
 * `boot/jaga-tunnel.js` menulis ulang `IPOS_*_URL` ke URL tunnel setiap kali
 * nilainya berbeda, tiap 60 detik. Begitu URL diarahkan ke alamat Tailscale,
 * pengawas itu akan mengembalikannya terus-menerus -> Railway redeploy tanpa
 * henti dan deploy TIDAK PERNAH stabil.
 *
 * URUTAN PENTING (jangan dibalik):
 *   1. Matikan task autostart  -> supaya tidak bangkit saat reboot
 *   2. Hapus entri HKCU Run    -> jalur autostart kedua
 *   3. Hentikan proses         -> yang sedang jalan sekarang
 *   4. Matikan cloudflared     -> tunnel-nya tidak berguna lagi
 *   5. Hapus lock              -> supaya bisa dihidupkan lagi bila perlu
 *   6. Verifikasi              -> DAN pastikan penjaga poller TETAP hidup
 *
 * YANG TIDAK DISENTUH
 * -------------------
 *   - `jaga-poller-tunggal.js` WAJIB tetap hidup (tugasnya menjaga satu poller)
 *   - proxy iPos (port 8080)
 *   - Tailscale
 *
 * Pemakaian:  node boot\pensiun-tunnel.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:\\BOT-TELEGRAM-';
const LOCK = path.join(ROOT, 'boot', '.jaga-tunnel.lock');
const langkah = [];

function ps(skrip) {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', skrip], {
      encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    }).trim();
  } catch (e) {
    return 'ERR:' + String(e.stderr || e.message).replace(/\s+/g, ' ').slice(0, 160);
  }
}

function catat(nama, ok, detail) {
  langkah.push({ nama, ok, detail });
  console.log('  ' + (ok ? 'OK    ' : 'GAGAL ') + nama.padEnd(44) + (detail == null ? '' : detail));
}

/** Proses node yang menjalankan jaga-tunnel (BUKAN jaga-poller). */
function prosesJagaTunnel() {
  const out = ps(
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
    "Where-Object { $_.CommandLine -match 'jaga-tunnel' } | ForEach-Object { $_.ProcessId }"
  );
  return out.split(/\r?\n/).map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
}

function prosesJagaPoller() {
  const out = ps(
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
    "Where-Object { $_.CommandLine -match 'jaga-poller-tunggal' } | ForEach-Object { $_.ProcessId }"
  );
  return out.split(/\r?\n/).map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
}

function cloudflared() {
  const out = ps("Get-Process cloudflared -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }");
  return out.split(/\r?\n/).map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
}

console.log('=== pensiun pengawas tunnel ===');

// 1. task autostart
const st = ps('$t = Get-ScheduledTask -TaskName "BCODE-JAGA-TUNNEL" -ErrorAction SilentlyContinue; if ($t) { $t.State } else { "TIDAK-ADA" }');
if (st === 'TIDAK-ADA') {
  catat('task BCODE-JAGA-TUNNEL', true, 'tidak ada (sudah bersih)');
} else {
  ps('Disable-ScheduledTask -TaskName "BCODE-JAGA-TUNNEL" -ErrorAction SilentlyContinue | Out-Null');
  const st2 = ps('(Get-ScheduledTask -TaskName "BCODE-JAGA-TUNNEL").State');
  catat('task BCODE-JAGA-TUNNEL -> Disabled', st2 === 'Disabled', 'state=' + st2);
}

// 2. entri HKCU Run
const k = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const adaRun = ps('if (Test-Path \'' + k + '\') { ((Get-ItemProperty \'' + k + '\').PSObject.Properties.Name -contains "BCODE_JAGA_TUNNEL") } else { "False" }');
if (/True/i.test(adaRun)) {
  ps('Remove-ItemProperty -Path \'' + k + '\' -Name "BCODE_JAGA_TUNNEL" -Force -ErrorAction SilentlyContinue');
  const masih = ps('((Get-ItemProperty \'' + k + '\').PSObject.Properties.Name -contains "BCODE_JAGA_TUNNEL")');
  catat('hapus autostart HKCU BCODE_JAGA_TUNNEL', !/True/i.test(masih), 'masih ada=' + masih);
} else {
  catat('autostart HKCU BCODE_JAGA_TUNNEL', true, 'tidak ada (sudah bersih)');
}

// 3. proses jaga-tunnel
const pids = prosesJagaTunnel();
if (pids.length) {
  for (const p of pids) ps('Stop-Process -Id ' + p + ' -Force -ErrorAction SilentlyContinue');
  const sisa = prosesJagaTunnel();
  catat('hentikan proses jaga-tunnel', sisa.length === 0, 'dibunuh=' + pids.join(',') + ' sisa=' + (sisa.join(',') || '0'));
} else {
  catat('proses jaga-tunnel', true, 'tidak ada yang berjalan');
}

// 4. cloudflared
const cf = cloudflared();
if (cf.length) {
  for (const p of cf) ps('Stop-Process -Id ' + p + ' -Force -ErrorAction SilentlyContinue');
  const sisa = cloudflared();
  catat('hentikan cloudflared', sisa.length === 0, 'dibunuh=' + cf.join(',') + ' sisa=' + (sisa.join(',') || '0'));
} else {
  catat('proses cloudflared', true, 'tidak ada yang berjalan');
}

// 5. lock
try {
  if (fs.existsSync(LOCK)) { fs.unlinkSync(LOCK); catat('hapus lock jaga-tunnel', true, 'dihapus'); }
  else catat('lock jaga-tunnel', true, 'tidak ada');
} catch (e) {
  catat('hapus lock jaga-tunnel', false, String(e.message).slice(0, 100));
}

// 6. verifikasi akhir — termasuk memastikan penjaga poller TETAP hidup
console.log('\n=== verifikasi akhir ===');
const sisaTunnel = prosesJagaTunnel();
catat('tidak ada proses jaga-tunnel', sisaTunnel.length === 0, sisaTunnel.join(',') || 'bersih');

const sisaCf = cloudflared();
catat('tidak ada proses cloudflared', sisaCf.length === 0, sisaCf.join(',') || 'bersih');

const poller = prosesJagaPoller();
catat('penjaga poller TETAP hidup', poller.length === 1, 'pid=' + (poller.join(',') || 'TIDAK ADA'));

const proxy = ps('Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $_.OwningProcess }');
catat('proxy iPos :8080 tetap hidup', proxy.trim().length > 0, 'pid=' + (proxy.trim() || 'TIDAK ADA'));

const gagal = langkah.filter((l) => !l.ok);
console.log('\n=== RINGKASAN ===');
console.log('  ok ' + (langkah.length - gagal.length) + '/' + langkah.length);
if (gagal.length) {
  gagal.forEach((g) => console.log('  GAGAL: ' + g.nama + ' (' + g.detail + ')'));
  process.exit(1);
}
console.log('  PENGAWAS TUNNEL SUDAH DIPENSIUNKAN.');
console.log('  Untuk menghidupkan lagi: Enable-ScheduledTask BCODE-JAGA-TUNNEL, lalu node boot\\jaga-tunnel.js');

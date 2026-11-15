'use strict';
/**
 * Pasang pengawas tunnel + penjaga poller supaya hidup sendiri setelah reboot.
 *
 * KENAPA DUA JALUR (task + HKCU Run)
 * ----------------------------------
 * - `New-ScheduledTaskTrigger -AtStartup` butuh hak ADMIN. Mesin ini jalan
 *   sebagai user biasa -> "Access is denied". Sudah dibuktikan 2026-11-15.
 * - Karena itu dipakai trigger `-AtLogOn` (tidak butuh admin), PERSIS pola
 *   yang sudah terbukti bekerja di mesin ini untuk `iPosAPI`.
 * - Ditambah entri HKCU Run sebagai cadangan, karena HKCU Run terbukti
 *   berjalan (entri `iPosAPI` dan `PM2` memang jalan).
 *
 * Dobel-jalan tidak berbahaya: kedua skrip punya LOCK FILE sendiri, jadi
 * salinan kedua langsung keluar dengan kode 2.
 *
 * Pemakaian:  node boot\pasang-task-jaga.js
 */
const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = 'C:\\BOT-TELEGRAM-';
const VBS = path.join(ROOT, 'boot', 'run-hidden.vbs');

const TASKS = [
  { nama: 'BCODE-JAGA-TUNNEL', ps1: path.join(ROOT, 'boot', 'jaga-tunnel.ps1'), run: 'BCODE_JAGA_TUNNEL' },
  { nama: 'BCODE-JAGA-POLLER', ps1: path.join(ROOT, 'boot', 'jaga-poller.ps1'), run: 'BCODE_JAGA_POLLER' },
];

function ps(skrip) {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', skrip], {
      encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    }).trim();
  } catch (e) {
    return 'ERROR: ' + String((e.stderr || e.message)).replace(/\s+/g, ' ').slice(0, 240);
  }
}

// ------------------------------------------------------------------- 1. task
console.log('=== 1. scheduled task (trigger AtLogOn, tidak butuh admin) ===');
for (const t of TASKS) {
  const skrip =
    '$ErrorActionPreference = "Stop"; ' +
    'try { ' +
    '$a = New-ScheduledTaskAction -Execute "wscript.exe" -Argument \'"' + VBS + '" "' + t.ps1 + '"\'; ' +
    '$tr = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME; ' +
    '$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries ' +
    '-StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) ' +
    '-ExecutionTimeLimit (New-TimeSpan -Days 0) -MultipleInstances IgnoreNew; ' +
    '$p = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited; ' +
    'Register-ScheduledTask -TaskName "' + t.nama + '" -Action $a -Trigger $tr ' +
    '-Settings $s -Principal $p -Force | Out-Null; ' +
    '"OK" } catch { "ERROR: " + $_.Exception.Message }';
  console.log('  ' + t.nama.padEnd(20) + ' ' + ps(skrip));
}

// --------------------------------------------------------------- 2. HKCU Run
console.log('\n=== 2. HKCU Run (cadangan, pola yang sudah terbukti di mesin ini) ===');
for (const t of TASKS) {
  const nilai = 'wscript.exe "' + VBS + '" "' + t.ps1 + '"';
  const skrip =
    '$k = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"; ' +
    'Set-ItemProperty -Path $k -Name "' + t.run + '" -Value \'' + nilai + '\' -Force; ' +
    '(Get-ItemProperty $k).' + t.run;
  console.log('  ' + t.run.padEnd(20) + ' ' + ps(skrip));
}

// ----------------------------------------------------------------- 3. laporan
console.log('\n=== 3. state task BCODE ===');
console.log(ps('Get-ScheduledTask -TaskName "BCODE*" -ErrorAction SilentlyContinue | ForEach-Object { "  " + $_.TaskName.PadRight(26) + " state=" + $_.State }'));

console.log('\n=== 4. entri HKCU Run ===');
console.log(ps('$k = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"; (Get-ItemProperty $k).PSObject.Properties | Where-Object { $_.Name -notmatch "^PS" } | ForEach-Object { "  " + $_.Name + " = " + $_.Value }'));

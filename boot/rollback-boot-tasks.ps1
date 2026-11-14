$ErrorActionPreference = 'Stop'

# Rollback task boot BCODE-KEFA (butuh UAC/admin).
# Mengembalikan autostart login lama (PM2 + iPosAPI), mengaktifkan watchdog
# lama, dan menghapus tiga task boot baru.

$root    = 'C:\BOT-TELEGRAM-'
$bootDir = Join-Path $root 'boot'
$log     = Join-Path $root 'logs\rollback-boot-tasks.log'
$backup  = Join-Path $bootDir 'autostart-backup.json'
$runKey  = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
function Write-Log([string]$m) {
  try { Add-Content $log ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) } catch {}
}

$identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $argLine = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argLine
  exit
}

Write-Log 'rollback elevated start'

foreach ($name in 'BCODE-KEFA-WATCHDOG','BCODE-KEFA-BOT','BCODE-KEFA-IPOS') {
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Write-Log "task $name dihapus"
}

# Hentikan listener baru agar tidak bentrok dengan PM2/iPos lama.
foreach ($port in 3001, 8080) {
  $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) {
    taskkill /PID $c.OwningProcess /F /T 2>&1 | Out-Null
    Write-Log "listener port $port dihentikan"
    Start-Sleep -Seconds 2
  }
}

$oldPm2 = 'wscript.exe "C:\Users\rdpadmin\AppData\Roaming\npm\node_modules\pm2-windows-startup\invisible.vbs" "C:\Users\rdpadmin\AppData\Roaming\npm\node_modules\pm2-windows-startup\pm2_resurrect.cmd"'
$oldIpos = 'wscript.exe C:\Users\rdpadmin\ipos-api\run-ipos-api.vbs'

if (Test-Path $backup) {
  try {
    $b = Get-Content $backup -Raw | ConvertFrom-Json
    if ($null -ne $b.PM2) { $oldPm2 = $b.PM2 }
    if ($null -ne $b.iPosAPI) { $oldIpos = $b.iPosAPI }
    Write-Log 'backup autostart dibaca'
  } catch {
    Write-Log "backup autostart tidak terbaca: $($_.Exception.Message)"
  }
}

Set-ItemProperty -Path $runKey -Name 'PM2' -Value $oldPm2
Set-ItemProperty -Path $runKey -Name 'iPosAPI' -Value $oldIpos
Write-Log 'autostart PM2/iPosAPI lama dipulihkan'

# Perbaiki kutip tunggal yang membuat task watchdog lama gagal, lalu enable.
schtasks /change /tn "Watchdog-Bot-Telegram" /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\BOT-TELEGRAM-\watchdog-bot.ps1" /it 2>&1 | Out-Null
Enable-ScheduledTask -TaskName 'Watchdog-Bot-Telegram' -ErrorAction SilentlyContinue | Out-Null
Write-Log 'watchdog lama diperbaiki command-nya + di-enable'

# Nyalakan kembali layanan lama.
Start-Process -FilePath 'wscript.exe' -ArgumentList '"C:\Users\rdpadmin\ipos-api\run-ipos-api.vbs"' -WindowStyle Hidden
$env:PM2_HOME = 'C:\Users\rdpadmin\.pm2'
$pm2 = Join-Path $env:APPDATA 'npm\pm2.cmd'
if (Test-Path $pm2) {
  & $pm2 resurrect *>> $log
  if ($LASTEXITCODE -ne 0) { & $pm2 start (Join-Path $root 'ecosystem.config.js') *>> $log }
} else {
  Write-Log 'pm2.cmd tidak ditemukan'
}

Write-Host 'Rollback selesai. Cek health 3001/8080 setelah 10-20 detik.'
Write-Log 'rollback selesai'
Write-Host 'Tekan Enter untuk menutup.'
Read-Host | Out-Null

$ErrorActionPreference = 'SilentlyContinue'

# Fallback saat user login (HKCU Run).
# Hanya menghidupkan PM2 jika bot BELUM sehat. Jika task BCODE-KEFA-BOT
# sudah jalan sebelum login, script ini langsung selesai tanpa membuat
# instance kedua (menghindari konflik polling Telegram 409).

$dir    = 'C:\BOT-TELEGRAM-'
$log    = Join-Path $dir 'logs\logon-fallback.log'
$health = 'http://127.0.0.1:3001/health'

Set-Location $dir
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 524288)) {
  Get-Content $log -Tail 300 | Set-Content $log
}

function Write-Log([string]$m) {
  try { Add-Content $log ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) } catch {}
}

function Test-BotReady {
  try {
    $r = Invoke-RestMethod -Uri $health -TimeoutSec 5
    return ($null -ne $r -and $r.status -eq 'OK' -and $r.polling -eq $true)
  } catch {
    return $false
  }
}

# Beri task boot waktu menyelesaikan startup sebelum fallback menyalakan PM2.
for ($i = 0; $i -lt 18; $i++) {
  if (Test-BotReady) {
    Write-Log 'bot sudah sehat; fallback login tidak perlu start'
    exit 0
  }
  Start-Sleep -Seconds 5
}

Write-Log 'bot belum sehat setelah 90 detik; fallback PM2 resurrect'
$env:PM2_HOME = 'C:\Users\rdpadmin\.pm2'
$env:Path = "C:\Program Files\nodejs;C:\Users\rdpadmin\AppData\Roaming\npm;$env:Path"
$pm2 = Join-Path $env:APPDATA 'npm\pm2.cmd'

if (-not (Test-Path $pm2)) {
  Write-Log 'pm2.cmd tidak ditemukan; fallback gagal'
  exit 1
}

& $pm2 resurrect *>> $log
Start-Sleep -Seconds 5

if (-not (Test-BotReady)) {
  Write-Log 'resurrect belum sehat; start dari ecosystem'
  & $pm2 start (Join-Path $dir 'ecosystem.config.js') --update-env *>> $log
  & $pm2 save *>> $log
}

if (Test-BotReady) { Write-Log 'fallback PM2 berhasil' } else { Write-Log 'fallback PM2 belum sehat' }
exit 0

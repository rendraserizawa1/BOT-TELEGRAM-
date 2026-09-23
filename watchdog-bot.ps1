$ErrorActionPreference = 'SilentlyContinue'
# Watchdog Bot Telegram - dipakai Scheduled Task "Watchdog-Bot-Telegram"
# (At startup + tiap 5 menit, jalan sebagai user tanpa perlu login Windows).
$dir     = 'C:\Users\kassa\BOT-TELEGRAM-'
$log     = 'C:\Users\kassa\.pm2\watchdog.log'
$npmDir  = 'C:\Users\kassa\AppData\Roaming\npm'
$nodeDir = 'C:\Program Files\nodejs'

$env:Path = "$nodeDir;$npmDir;$env:Path"

function Log($m) { Add-Content $log "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $m" }

function Healthy {
  try {
    $r = Invoke-WebRequest -Uri 'http://localhost:3001/health' -UseBasicParsing -TimeoutSec 8
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

# Pakai shim pm2 kalau ada, fallback langsung ke bin JS (tahan kasus shim hilang)
function Pm2 {
  if (Test-Path "$npmDir\pm2.cmd") { & "$npmDir\pm2.cmd" @args }
  else { & node "$npmDir\node_modules\pm2\bin\pm2" @args }
}

if (Healthy) { exit 0 }

Log 'bot DOWN - mencoba hidupkan'
Set-Location $dir

for ($i = 1; $i -le 3; $i++) {
  Pm2 resurrect | Out-Null
  Start-Sleep -Seconds 20
  if (Healthy) { Log "pulih via resurrect (percobaan $i)"; exit 0 }

  Pm2 start index.js --name telegram-perabot | Out-Null
  Pm2 save | Out-Null
  Start-Sleep -Seconds 20
  if (Healthy) { Log "pulih via start manual (percobaan $i)"; exit 0 }
  Start-Sleep -Seconds 15
}

Log 'GAGAL pulihkan'
exit 1

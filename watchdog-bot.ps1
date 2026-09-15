$ErrorActionPreference = 'SilentlyContinue'
# Watchdog: pastikan Bot Telegram (port 3001) hidup. Kalau mati -> pm2 resurrect/start.
$dir = 'C:\Users\kassa\BOT-TELEGRAM-'
$log = 'C:\Users\kassa\.pm2\watchdog.log'

try {
  $r = Invoke-WebRequest -Uri 'http://localhost:3001/health' -UseBasicParsing -TimeoutSec 8
  if ($r.StatusCode -eq 200) { exit 0 }
} catch {}

Add-Content $log "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] bot DOWN - mencoba hidupkan"
Set-Location $dir

# cara 1: resurrect list tersimpan
pm2 resurrect 2>&1 | Out-Null
Start-Sleep -Seconds 20
try {
  $r = Invoke-WebRequest -Uri 'http://localhost:3001/health' -UseBasicParsing -TimeoutSec 8
  if ($r.StatusCode -eq 200) { Add-Content $log "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] pulih via resurrect"; exit 0 }
} catch {}

# cara 2: start manual
pm2 start index.js --name telegram-perabot 2>&1 | Out-Null
pm2 save 2>&1 | Out-Null
Start-Sleep -Seconds 20
try {
  $r = Invoke-WebRequest -Uri 'http://localhost:3001/health' -UseBasicParsing -TimeoutSec 8
  if ($r.StatusCode -eq 200) { Add-Content $log "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] pulih via start manual"; exit 0 }
} catch {}

Add-Content $log "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] GAGAL pulihkan"
exit 1
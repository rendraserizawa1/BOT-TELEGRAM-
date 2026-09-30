$ErrorActionPreference = 'SilentlyContinue'
# Watchdog Bot Telegram - Scheduled Task "Watchdog-Bot-Telegram".
# Checks /health + polling. Kills an unresponsive listener only after
# a second failed probe and startup grace to avoid interrupting active work.

# One-shot admin hook used for production maintenance.
$markerProd = 'C:\Users\kassa\AppData\Local\Temp\opencode\run_prod.txt'
if (Test-Path $markerProd) {
  Remove-Item $markerProd -Force
  & powershell -NoProfile -ExecutionPolicy Bypass -File 'C:\Users\kassa\AppData\Local\Temp\opencode\restart_prod.ps1' *> 'C:\Users\kassa\AppData\Local\Temp\opencode\restart_prod_child.log'
}

$dir = 'C:\Users\kassa\BOT-TELEGRAM-'
$log = 'C:\Users\kassa\.pm2\watchdog.log'
$npmDir = 'C:\Users\kassa\AppData\Roaming\npm'
$nodeDir = 'C:\Program Files\nodejs'
$port = 3001
$env:Path = "$nodeDir;$npmDir;$env:Path"

# Keep the log small (trim to last 400 lines above 512 KB).
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 524288)) {
  Get-Content $log -Tail 400 | Set-Content $log
}

function Log($m) { Add-Content $log "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $m" }
function Pm2 {
  if (Test-Path "$npmDir\pm2.cmd") { & "$npmDir\pm2.cmd" @args }
  else { & node "$npmDir\node_modules\pm2\bin\pm2" @args }
}

# Sehat => $null. Tidak sehat => alasan (string).
function HealthReason {
  try { $r = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 8 }
  catch { return 'health timeout/error' }
  if (-not $r -or $r.status -ne 'OK') { return 'status bukan OK' }
  if ($null -ne $r.polling -and -not $r.polling) { return 'polling Telegram mati' }
  return $null
}

function ListenerInfo {
  $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $c) { return $null }
  $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
  $umur = 99999
  if ($p -and $p.StartTime) { $umur = [int]((Get-Date) - $p.StartTime).TotalSeconds }
  return @{ Pid = $c.OwningProcess; Umur = $umur }
}

function BotProcessAge {
  $target = Join-Path $dir 'index.js'
  $now = Get-Date
  $matches = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($target, [StringComparison]::OrdinalIgnoreCase) -ge 0 }
  foreach ($proc in $matches) {
    try {
      $created = [Management.ManagementDateTimeConverter]::ToDateTime($proc.CreationDate)
      $age = [int]($now - $created).TotalSeconds
      if ($age -lt 180) { return $age }
    } catch {}
  }
  return 99999
}

function KillListener {
  $li = ListenerInfo
  if ($li) {
    Log "kill listener pid $($li.Pid)"
    taskkill /PID $li.Pid /F /T 2>&1 | Out-Null
    return $true
  }
  return $false
}

function WaitHealthy([int]$seconds) {
  $steps = [Math]::Ceiling($seconds / 5)
  for ($n = 0; $n -lt $steps; $n++) {
    Start-Sleep -Seconds 5
    if ($null -eq (HealthReason)) { return $true }
  }
  return $false
}

$reason = HealthReason
if ($null -eq $reason) { exit 0 }

# Konfirmasi ganda: beri operasi sinkron besar (mis. muat Excel) waktu selesai.
Start-Sleep -Seconds 30
$reason2 = HealthReason
if ($null -eq $reason2) { Log "cek-1 gagal ($reason) tapi cek-2 sehat - abaikan"; exit 0 }

# Grace period juga berlaku saat server belum bind port (Excel load dapat memakan waktu).
$botAge = BotProcessAge
if ($botAge -lt 180) {
  Log "bot masih startup ($($botAge)s) - tunggu siklus berikutnya"
  exit 0
}
$li = ListenerInfo
if ($li -and $li.Umur -lt 180) {
  Log "listener baru ($($li.Umur)s) - tunggu siklus berikutnya"
  exit 0
}

Log "bot tidak sehat ($reason2) - recovery"
Set-Location $dir

# A killed PM2 child auto-restarts. Give full startup time before trying again.
$hadListener = KillListener
if (-not $hadListener) {
  Pm2 resurrect 2>&1 | Out-Null
  Start-Sleep -Seconds 3
  if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
    Pm2 restart telegram-perabot --update-env 2>&1 | Out-Null
  }
}
if (WaitHealthy 90) { Log 'pulih setelah PM2 restart'; exit 0 }

# Fallback start from ecosystem if PM2 has no saved app entry.
Log 'PM2 restart belum pulih; coba start ecosystem'
Pm2 start ecosystem.config.js 2>&1 | Out-Null
Pm2 save 2>&1 | Out-Null
if (WaitHealthy 90) { Log 'pulih via ecosystem'; exit 0 }

# One final restart only; do not interrupt a long startup repeatedly.
Log 'belum pulih setelah 90 detik; restart kedua'
KillListener | Out-Null
Pm2 restart telegram-perabot --update-env 2>&1 | Out-Null
if (WaitHealthy 90) { Log 'pulih setelah restart kedua'; exit 0 }

# Recover a missing PM2 entry from the saved process list.
Log 'PM2 restart gagal; coba resurrect'
Pm2 resurrect 2>&1 | Out-Null
if (WaitHealthy 90) { Log 'pulih via resurrect'; exit 0 }

Log ("gagal pulih: " + (HealthReason))
exit 1

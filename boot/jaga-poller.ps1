# Wrapper task BCODE-JAGA-POLLER.
# Menjalankan penjaga poller tunggal (boot/jaga-poller-tunggal.js).
# Tugasnya MEMASTIKAN tidak ada bot lokal yang ikut polling Telegram.
# Skrip ini tidak pernah menjalankan bot — justru membunuh bot lokal.

$ErrorActionPreference = 'Continue'

$dir     = 'C:\BOT-TELEGRAM-'
$node    = 'C:\Program Files\nodejs\node.exe'
$skrip   = Join-Path $dir 'boot\jaga-poller-tunggal.js'
$logDir  = Join-Path $dir 'logs'
$log     = Join-Path $logDir 'jaga-poller.log'

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

try {
  if ((Test-Path $log) -and ((Get-Item $log).Length -gt 5MB)) {
    Move-Item -LiteralPath $log -Destination "$log.1" -Force
  }
} catch {}

function Tulis([string]$m) {
  try { Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) } catch {}
}

if (-not (Test-Path $skrip)) {
  Tulis "GAGAL: $skrip tidak ada"
  exit 1
}
if (-not (Test-Path $node)) {
  $node = 'node'
}

Tulis "wrapper jaga-poller mulai (pid=$PID)"

for ($i = 1; $i -le 100000; $i++) {
  Tulis "menjalankan node jaga-poller-tunggal.js (percobaan $i)"
  try {
    & $node $skrip *>> $log
    Tulis "node berhenti exit=$LASTEXITCODE"
  } catch {
    Tulis ("node gagal: " + $_.Exception.Message)
  }
  Start-Sleep -Seconds 20
}

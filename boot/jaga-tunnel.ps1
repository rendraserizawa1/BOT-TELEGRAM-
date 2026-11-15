# Wrapper task BCODE-JAGA-TUNNEL.
# Menjalankan pengawas tunnel iPos (boot/jaga-tunnel.js) tanpa jendela.
# Skrip ini TIDAK pernah menyalakan bot lokal — hanya tunnel.

$ErrorActionPreference = 'Continue'

$dir     = 'C:\BOT-TELEGRAM-'
$node    = 'C:\Program Files\nodejs\node.exe'
$skrip   = Join-Path $dir 'boot\jaga-tunnel.js'
$logDir  = Join-Path $dir 'logs'
$log     = Join-Path $logDir 'jaga-tunnel.log'

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# Putar log bila sudah besar (jangan sampai menghabiskan disk 72 GB).
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
  $node = 'node'   # biarkan PATH yang mencari
}

Tulis "wrapper jaga-tunnel mulai (pid=$PID)"

# Loop luar: kalau node mati karena sebab apa pun, hidupkan lagi.
# Lock file di dalam jaga-tunnel.js mencegah dua salinan berjalan bersamaan.
for ($i = 1; $i -le 100000; $i++) {
  Tulis "menjalankan node jaga-tunnel.js (percobaan $i)"
  try {
    & $node $skrip *>> $log
    Tulis "node berhenti exit=$LASTEXITCODE"
  } catch {
    Tulis ("node gagal: " + $_.Exception.Message)
  }
  Start-Sleep -Seconds 20
}

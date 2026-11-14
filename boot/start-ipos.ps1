$ErrorActionPreference = 'Continue'

# Wrapper task BCODE-KEFA-IPOS.
# Menjalankan iPos API KEFA (port 8080) langsung dengan Node saat boot,
# sebelum user login. Task Scheduler menjadi induk proses + restart on failure.

$dir      = 'C:\Users\rdpadmin\ipos-api'
$node     = 'C:\Program Files\nodejs\node.exe'
$log      = Join-Path $dir 'api-service.log'
$bootLog  = 'C:\BOT-TELEGRAM-\logs\boot-events.log'
$health   = 'http://127.0.0.1:8080/ipos/health'

Set-Location $dir
New-Item -ItemType Directory -Force -Path (Split-Path $bootLog) | Out-Null

function Write-BootLog([string]$m) {
  try {
    if ((Test-Path $bootLog) -and ((Get-Item $bootLog).Length -gt 1MB)) {
      Get-Content $bootLog -Tail 200 | Set-Content $bootLog
    }
    Add-Content $bootLog ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m)
  } catch {}
}

function Rotate-Log([string]$path, [long]$limit) {
  try {
    if ((Test-Path $path) -and ((Get-Item $path).Length -gt $limit)) {
      Move-Item -LiteralPath $path -Destination "$path.1" -Force
    }
  } catch {}
}

function Test-IposHealth {
  try {
    $r = Invoke-RestMethod -Uri $health -TimeoutSec 5
    return ($null -ne $r -and $r.ok -eq $true)
  } catch {
    return $false
  }
}

Write-BootLog "wrapper ipos mulai (pid=$PID)"

if (Test-IposHealth) {
  Write-BootLog 'ipos api sudah sehat; wrapper tidak start ulang'
  exit 0
}

if (-not (Test-Path (Join-Path $dir 'server.js'))) {
  Write-BootLog "server.js tidak ditemukan di $dir"
  exit 1
}
if (-not (Test-Path $node)) {
  Write-BootLog "node tidak ditemukan: $node"
  exit 1
}

Rotate-Log $log (20MB)
Write-BootLog 'menjalankan node --env-file=.env server.js'

& $node --env-file=.env server.js *>> $log

$code = $LASTEXITCODE
Write-BootLog "ipos server.js berhenti exit=$code"
if ($null -eq $code -or $code -eq 0) { $code = 1 }
exit $code

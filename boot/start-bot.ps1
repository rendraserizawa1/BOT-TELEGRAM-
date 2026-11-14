$ErrorActionPreference = 'Continue'

# Wrapper task BCODE-KEFA-BOT.
# Dipanggil Windows Task Scheduler saat boot (sebelum login).
# Menjalankan bot langsung dengan Node, bukan lewat PM2, supaya task
# tetap menjadi induk proses dan bisa di-restart oleh Task Scheduler.

$dir      = 'C:\BOT-TELEGRAM-'
$node     = 'C:\Program Files\nodejs\node.exe'
$log      = Join-Path $dir 'logs\service-out.log'
$errLog   = Join-Path $dir 'logs\service-err.log'
$errorLog = Join-Path $dir 'logs\error.log'
$bootLog  = Join-Path $dir 'logs\boot-events.log'
$health   = 'http://127.0.0.1:3001/health'

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

function Test-BotHealth {
  try {
    $r = Invoke-RestMethod -Uri $health -TimeoutSec 5
    return ($null -ne $r -and $r.status -eq 'OK')
  } catch {
    return $false
  }
}

function Test-BotPort {
  try {
    return ($null -ne (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1))
  } catch {
    return $false
  }
}

Write-BootLog "wrapper bot mulai (pid=$PID)"

# Jangan start instance kedua jika bot sudah sehat (mis. saat instalasi/test
# atau saat fallback login sudah menghidupkan bot).
if (Test-BotHealth) {
  # Saat restart, proses lama bisa masih menjawab health sesaat sebelum mati.
  # Beri waktu, lalu pastikan port benar-benar kosong sebelum start.
  for ($i = 0; $i -lt 12; $i++) {
    Start-Sleep -Seconds 2
    if (-not (Test-BotHealth)) { break }
  }
  if (Test-BotHealth) {
    Write-BootLog 'bot sudah sehat; wrapper tidak start ulang'
    exit 0
  }
  Write-BootLog 'health hilang; menunggu port 3001 kosong'
}

for ($i = 0; $i -lt 30; $i++) {
  if (-not (Test-BotPort)) { break }
  Start-Sleep -Seconds 2
}
if (Test-BotPort) {
  Write-BootLog 'port 3001 masih dipakai; wrapper berhenti (tidak start ganda)'
  exit 1
}

# Arsipkan log lama setiap start; log aktif selalu bersih untuk run ini.
# Riwayat tetap ada di logs\archive dan sudah diimpor ke database.
try {
  $archiveDir = Join-Path $dir 'logs\archive'
  New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  foreach ($f in @($log, $errLog, $errorLog)) {
    if ((Test-Path -LiteralPath $f) -and ((Get-Item -LiteralPath $f).Length -gt 0)) {
      $base = [IO.Path]::GetFileNameWithoutExtension($f)
      Move-Item -LiteralPath $f -Destination (Join-Path $archiveDir ("{0}-{1}.log" -f $base, $stamp)) -Force
    }
  }
} catch {
  Write-BootLog ("arsip log gagal: " + $_.Exception.Message)
}

if (-not (Test-Path $node)) {
  Write-BootLog "node tidak ditemukan: $node"
  exit 1
}

Rotate-Log $log (20MB)
Rotate-Log $errLog (10MB)

# Backup .env ke data\secure dengan ACL ketat (isi tidak pernah dicetak).
try {
  $secureScript = Join-Path $dir 'boot\secure-env.ps1'
  if (Test-Path -LiteralPath $secureScript) {
    $secureOut = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $secureScript
    Write-BootLog ("secure-env: " + ($secureOut -join ' '))
  }
} catch {
  Write-BootLog ("secure-env gagal: " + $_.Exception.Message)
}

Write-BootLog 'menjalankan node index.js'

# Redirect langsung oleh proses anak, bukan pipe PowerShell. Jika wrapper
# task dihentikan, stdout anak tetap punya handle file dan tidak deadlock.
$nodeArgs = @(
  '--max-old-space-size=640',
  '--dns-result-order=ipv4first',
  (Join-Path $dir 'index.js')
)

# PENTING: wrapper ini dulu langsung `exit` saat node mati dan menggantungkan
# restart pada Task Scheduler. Di host ini restart-on-failure task TIDAK
# berjalan (terbukti: bot tertinggal mati ~3 menit, LastRunTime tidak berubah).
# Sekarang wrapper sendiri yang menghidupkan ulang node, sehingga matinya node
# tidak bergantung pada penjadwal.
#
# Aturan berhenti:
#   - exit code 2 = instance ganda / port 3001 dipakai (index.js sengaja
#     process.exit(2)). JANGAN langsung berhenti: lock basi pernah membuat
#     SEMUA start keluar dengan exit=2 sehingga bot diam total berjam-jam.
#     Coba ulang beberapa kali dengan jeda, baru menyerah ke watchdog.
#   - 6 kali mati cepat (<30 detik) berturut-turut = masalah konfigurasi,
#     bukan gangguan sesaat -> berhenti agar tidak berputar tanpa henti.
$maksPercobaan = 999
$matiCepat     = 0
$percobaan     = 0
$code          = 1
$kode2         = 0
$maksKode2     = 6

while ($percobaan -lt $maksPercobaan) {
  $percobaan++
  $mulai = Get-Date
  if ($percobaan -gt 1) { Write-BootLog "menjalankan ulang node (percobaan $percobaan)" }

  # PENTING: -PassThru + $proc.WaitForExit() TERBUKTI mengembalikan ExitCode
  # KOSONG di host ini (diuji: exit 2 -> "", padahal prosesnya jelas keluar 2).
  # Akibatnya cabang `exit=2` di bawah adalah dead code selama berbulan-bulan
  # dan log selalu berbunyi "berhenti exit= setelah 0 detik". Hanya
  # -PassThru -Wait yang membaca kode keluar dengan benar (diuji 0/2/3/7).
  $proc = Start-Process -FilePath $node -ArgumentList $nodeArgs -WorkingDirectory $dir `
    -RedirectStandardOutput $log -RedirectStandardError $errLog -NoNewWindow -PassThru -Wait
  $code = $proc.ExitCode
  if ($null -eq $code) { $code = 1 }
  $hidupDetik = [int]((Get-Date) - $mulai).TotalSeconds
  Write-BootLog "node index.js berhenti exit=$code setelah $hidupDetik detik"

  if ($code -eq 2) {
    $kode2++
    Write-BootLog "exit=2 (instance ganda / port dipakai) - percobaan $kode2 dari $maksKode2"
    if ($kode2 -ge $maksKode2) {
      Write-BootLog 'exit=2 berulang; wrapper berhenti (serahkan ke watchdog)'
      break
    }
    # Beri kesempatan instance lama benar-benar melepas port sebelum retry.
    for ($i = 0; $i -lt 15; $i++) {
      if (-not (Test-BotPort)) { break }
      Start-Sleep -Seconds 2
    }
    Start-Sleep -Seconds 5
    continue
  }
  $kode2 = 0
  if ($hidupDetik -lt 30) { $matiCepat++ } else { $matiCepat = 0 }
  if ($matiCepat -ge 6) {
    Write-BootLog 'node mati cepat 6 kali berturut-turut; wrapper berhenti (cek konfigurasi)'
    break
  }

  # Jangan hidupkan ulang kalau ternyata sudah ada instance sehat (mis. bot
  # dihidupkan manual atau oleh watchdog saat wrapper ini masih menunggu).
  try {
    $h = Invoke-RestMethod -Uri $health -TimeoutSec 5
    if ($h -and $h.status -eq 'OK') {
      Write-BootLog 'sudah ada instance sehat; wrapper menunggu sampai health hilang'
      for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 5
        try { $h2 = Invoke-RestMethod -Uri $health -TimeoutSec 5; if (-not ($h2 -and $h2.status -eq 'OK')) { break } } catch { break }
      }
    }
  } catch {}

  # Beri jeda supaya port 3001 sempat dilepas dan log tidak dibanjiri.
  Start-Sleep -Seconds 10
}

if ($null -eq $code -or $code -eq 0) { $code = 1 }
exit $code

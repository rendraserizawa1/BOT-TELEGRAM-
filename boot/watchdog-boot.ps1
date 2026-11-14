$ErrorActionPreference = 'SilentlyContinue'

# Watchdog BCODE-KEFA.
# Dijalankan Windows Task Scheduler tiap 1 menit (dan saat startup).
# Tugas: cek bot (3001) + iPos API KEFA (8080), restart task terkait
# hanya setelah 2 kali gagal berturut-turut dan melewati masa startup.

$dir       = 'C:\BOT-TELEGRAM-'
$log       = Join-Path $dir 'logs\watchdog-boot.log'
$botTask   = 'BCODE-KEFA-BOT'
$iposTask  = 'BCODE-KEFA-IPOS'
$botPort   = 3001
$iposPort  = 8080
$botFail   = Join-Path $dir 'logs\watchdog-bot-fails.txt'
$iposFail  = Join-Path $dir 'logs\watchdog-ipos-fails.txt'
$lagLimit  = 45000

New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 524288)) {
  Get-Content $log -Tail 400 | Set-Content $log
}

function Write-Log([string]$m) {
  try { Add-Content $log ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) } catch {}
}

# Emergency kill switch (dijalankan watchdog sebagai Highest):
# buat boot\kill-bot.txt berisi PID, lalu jalankan task watchdog sekali.
$killFile = Join-Path $dir 'boot\kill-bot.txt'
if (Test-Path -LiteralPath $killFile) {
  $targetPid = ''
  try {
    $targetPid = (Get-Content -LiteralPath $killFile -Raw).Trim()
    if ($targetPid -match '^\d+$') {
      Write-Log "kill-bot manual: PID $targetPid"
      taskkill /PID $targetPid /F /T 2>&1 | Out-Null
      Start-Sleep -Seconds 2
    }
  } catch {}
  Remove-Item -LiteralPath $killFile -Force -ErrorAction SilentlyContinue

  # PENTING: dulu blok ini langsung `exit 0`, sehingga restart bergantung pada
  # siklus watchdog BERIKUTNYA. Di host ini siklus berikutnya bisa terlewat
  # (task IgnoreNew + satu siklus bisa >1 menit saat health timeout), dan bot
  # pernah tertinggal MATI ~3 menit. Sekarang kill dan restart dilakukan dalam
  # SATU jalannya watchdog supaya downtime hanya selama startup bot.
  Write-Log 'kill-bot: menghidupkan ulang bot sekarang (satu jalannya watchdog)'
  Stop-ScheduledTask -TaskName $botTask -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Start-ScheduledTask -TaskName $botTask -ErrorAction SilentlyContinue

  # Tunggu maksimal 150 detik sampai health menjawab lagi.
  $pulih = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 5
    try {
      $h = Invoke-RestMethod -Uri "http://127.0.0.1:$botPort/health" -TimeoutSec 8
      if ($h -and $h.status -eq 'OK') { $pulih = $true; break }
    } catch {}
  }
  if ($pulih) { Write-Log 'kill-bot: bot sudah menjawab health lagi' }
  else { Write-Log 'kill-bot: bot BELUM menjawab health setelah 150 detik' }
  exit 0
}

# Tugas sekali pakai (dijalankan elevated): bebaskan memori host yang
# diizinkan user. Penanda dihapus oleh skrip agar tidak berulang.
$freeMemMarker = Join-Path $dir 'boot\free-memory-once.txt'
if (Test-Path -LiteralPath $freeMemMarker) {
  $freeMemScript = Join-Path $dir 'boot\free-memory-once.ps1'
  if (Test-Path -LiteralPath $freeMemScript) {
    Write-Log 'menjalankan free-memory-once (elevated)'
    # Skrip menulis lognya sendiri ke logs\free-memory.log; jangan di-redirect
    # ke file yang sama (handle rebutan -> log jadi kosong).
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $freeMemScript | Out-Null
  } else {
    Remove-Item -LiteralPath $freeMemMarker -Force -ErrorAction SilentlyContinue
  }
}

function Get-Streak([string]$path) {
  try {
    $n = [int](Get-Content $path -TotalCount 1)
    if ($n -ge 0) { return $n }
  } catch {}
  return 0
}

function Set-Streak([string]$path, [int]$n) {
  try { Set-Content $path "$n" } catch {}
}

function Get-FreeRamMB {
  try {
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    return [int]($os.FreePhysicalMemory / 1KB)
  } catch { return 999999 }
}

# Apakah PROSES bot masih ada? Dipakai untuk membedakan dua kondisi yang
# sama-sama membuat health timeout:
#   (1) proses hidup tetapi dibekukan Windows karena host paging  -> JANGAN restart
#   (2) proses benar-benar mati / tidak ada listener               -> HARUS restart
# Sumber bukti: PID di storage\bot.lock harus masih hidup DAN memegang port.
function Test-BotProsesHidup {
  $lockPid = 0
  try {
    $lockPath = Join-Path $dir 'storage\bot.lock'
    if (Test-Path -LiteralPath $lockPath) {
      $j = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
      if ($j -and $j.pid) { $lockPid = [int]$j.pid }
    }
  } catch {}
  if ($lockPid -le 0) { return $false }
  $p = Get-Process -Id $lockPid -ErrorAction SilentlyContinue
  if (-not $p) { return $false }
  return $true
}

function Get-BotReason {
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$botPort/health" -TimeoutSec 25
  } catch {
    return 'health timeout/error'
  }
  if (-not $r -or $r.status -ne 'OK') { return 'status bukan OK' }
  if ($null -ne $r.polling -and -not $r.polling) { return 'polling Telegram mati' }
  if ($null -ne $r.telegramLastPollAgoSec -and [int]$r.telegramLastPollAgoSec -gt 300) {
    return "polling Telegram macet ($($r.telegramLastPollAgoSec)s tanpa getUpdates sukses)"
  }
  # Pakai lag SAAT INI, bukan max 60 detik. Satu stall lama (mis. sync iPos)
  # masih tersimpan di histori 60 detik dan bisa memicu restart kedua padahal
  # bot sudah normal kembali. Kalau event loop benar-benar macet sekarang,
  # request health di atas akan timeout lebih dulu.
  if ($null -ne $r.loopLagMs -and [long]$r.loopLagMs -gt $lagLimit) {
    return "event loop macet (lag $($r.loopLagMs)ms)"
  }
  if ($null -ne $r.loopLagMax60s -and [long]$r.loopLagMax60s -gt 120000) {
    return "event loop macet berat (max $($r.loopLagMax60s)ms)"
  }
  return $null
}

# Bot yang menjawab health tetapi TIDAK memproses Telegram sama sekali
# (mis. poller mati diam-diam) harus dianggap gagal meski RAM rendah.
#
# PENTING: health yang TIDAK MENJAWAB bukan bukti poller mati. Di host ini
# terbukti (boot\diag-stall.js) bahwa Windows membekukan proses bot selama
# 2-6 detik berulang kali saat RAM host kritis: CPU delta 0,00 s dan working
# set turun ke 21-45 MB. Pada kondisi itu health timeout, tetapi poller TETAP
# hidup dan pulih sendiri. Kalau timeout dianggap "poller mati", watchdog akan
# me-restart bot berulang-ulang justru saat host paling kekurangan RAM,
# sehingga bot makin lama tidak melayani chat. Karena itu timeout = "tidak
# diketahui" -> JANGAN restart saat RAM rendah.
function Test-BotPollerMati {
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$botPort/health" -TimeoutSec 25
    if (-not $r) { return $false }   # tidak ada jawaban = tidak diketahui
    if ($null -ne $r.polling -and -not $r.polling) { return $true }
    if ($null -ne $r.telegramLastPollAgoSec -and [int]$r.telegramLastPollAgoSec -gt 300) { return $true }
    return $false
  } catch {
    return $false                     # timeout/error: tidak diketahui
  }
}

function Get-IposReason {
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$iposPort/ipos/health" -TimeoutSec 20
  } catch {
    return 'health timeout/error'
  }
  if (-not $r -or $r.ok -ne $true) { return 'ok bukan true' }
  if ($r.lastError) { return "lastError: $($r.lastError)" }
  return $null
}

function Test-TaskExists([string]$name) {
  return ($null -ne (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue))
}

function Get-TaskAge([string]$name) {
  try {
    $i = Get-ScheduledTaskInfo -TaskName $name -ErrorAction Stop
    if ($i.LastRunTime) { return [int]((Get-Date) - $i.LastRunTime).TotalSeconds }
  } catch {}
  return 99999
}

function Kill-Port([int]$port) {
  $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) {
    Write-Log "kill listener port $port pid $($c.OwningProcess)"
    taskkill /PID $c.OwningProcess /F /T 2>&1 | Out-Null
    Start-Sleep -Seconds 2
  }
}

function Restart-Task([string]$name, [int]$port, [scriptblock]$check) {
  Write-Log "recovery task $name (port $port)"
  Kill-Port $port
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
  Start-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  for ($i = 0; $i -lt 24; $i++) {
    Start-Sleep -Seconds 5
    if (-not (& $check)) {
      Write-Log "$name pulih"
      return $true
    }
  }
  Write-Log "$name belum pulih setelah 120 detik"
  return $false
}

# Jangan restart apa pun pada 3 menit pertama setelah boot; beri waktu
# iPos API + bot menyelesaikan startup dan jaringan siap.
$uptimeMin = ((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalMinutes
if ($uptimeMin -lt 3) {
  Write-Log ("startup grace {0:N1} menit" -f $uptimeMin)
  exit 0
}

if (-not (Test-TaskExists $botTask) -or -not (Test-TaskExists $iposTask)) {
  Write-Log 'task boot belum terdaftar; watchdog berhenti'
  exit 1
}

$botReason  = Get-BotReason
$iposReason = Get-IposReason

if (-not $botReason -and -not $iposReason) {
  Set-Streak $botFail 0
  Set-Streak $iposFail 0
  Write-Log 'cek: bot=OK ipos=OK'
  exit 0
}

# ---------- Bot ----------
if ($botReason) {
  $s = (Get-Streak $botFail) + 1
  Set-Streak $botFail $s
  if ($s -lt 2) {
    Write-Log "bot gagal #$s ($botReason) - tunggu siklus berikutnya"
  } else {
    Start-Sleep -Seconds 20
    $botReason2 = Get-BotReason
    if (-not $botReason2) {
      Set-Streak $botFail 0
      Write-Log 'bot pulih saat cek konfirmasi'
    } else {
      $age = Get-TaskAge $botTask
      if ($age -lt 360) {
        Write-Log "bot masih startup ($age detik) - tunggu siklus berikutnya"
      } else {
        $ramMB = Get-FreeRamMB
        $pollerMati = Test-BotPollerMati
        $prosesHidup = Test-BotProsesHidup

        if ($pollerMati) {
          # Health MENJAWAB dan melaporkan polling mati/macet -> kerusakan nyata.
          Write-Log "poller Telegram TERBUKTI mati (RAM $ramMB MB); restart dijalankan"
          Restart-Task $botTask $botPort { Get-BotReason } | Out-Null
          Set-Streak $botFail 0
        } elseif (-not $prosesHidup) {
          # Tidak ada proses bot sama sekali -> mati, harus dihidupkan.
          Write-Log "proses bot tidak ada (lock PID mati); restart dijalankan"
          Restart-Task $botTask $botPort { Get-BotReason } | Out-Null
          Set-Streak $botFail 0
        } elseif ($ramMB -lt 200) {
          # Proses hidup tetapi health timeout: host paging (terbukti CPU 0,00 s).
          # Restart hanya menambah beban dan memperpanjang downtime.
          Write-Log "RAM bebas $ramMB MB; restart ditunda (host paging, proses masih hidup)"
        } elseif ($s -ge 5) {
          # Proses hidup, RAM cukup, tetapi health tak menjawab 5 siklus (~5 menit):
          # kemungkinan macet permanen. Baru sekarang restart.
          Write-Log "proses hidup tetapi health timeout $s siklus; restart dijalankan"
          Restart-Task $botTask $botPort { Get-BotReason } | Out-Null
          Set-Streak $botFail 0
        } else {
          Write-Log "health timeout sementara (RAM $ramMB MB, siklus $s); tunggu siklus berikutnya"
        }
      }
    }
  }
} else {
  Set-Streak $botFail 0
}

# ---------- iPos API ----------
if ($iposReason) {
  $s = (Get-Streak $iposFail) + 1
  Set-Streak $iposFail $s
  if ($s -lt 2) {
    Write-Log "ipos gagal #$s ($iposReason) - tunggu siklus berikutnya"
  } else {
    Start-Sleep -Seconds 15
    $iposReason2 = Get-IposReason
    if (-not $iposReason2) {
      Set-Streak $iposFail 0
      Write-Log 'ipos pulih saat cek konfirmasi'
    } else {
      $age = Get-TaskAge $iposTask
      if ($age -lt 360) {
        Write-Log "ipos masih startup ($age detik) - tunggu siklus berikutnya"
      } else {
        Restart-Task $iposTask $iposPort { Get-IposReason } | Out-Null
        Set-Streak $iposFail 0
      }
    }
  }
} else {
  Set-Streak $iposFail 0
}

exit 0


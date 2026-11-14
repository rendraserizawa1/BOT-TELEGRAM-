$ErrorActionPreference = 'Stop'

# Installer satu kali (butuh UAC/admin):
# - Membuat 3 scheduled task yang start SAAT BOOT, sebelum login:
#     BCODE-KEFA-IPOS      -> iPos API KEFA port 8080
#     BCODE-KEFA-BOT       -> bot Telegram + dashboard port 3001
#     BCODE-KEFA-WATCHDOG  -> cek health tiap 1 menit, restart task bila perlu
# - Mengganti autostart login PM2/iPosAPI menjadi fallback yang hanya
#   menyalakan proses lama jika task boot belum sehat.
# - TIDAK mematikan bot/iPos yang sedang berjalan.

$root    = 'C:\BOT-TELEGRAM-'
$bootDir = Join-Path $root 'boot'
$log     = Join-Path $root 'logs\install-boot-tasks.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null

function Write-Log([string]$m) {
  try { Add-Content $log ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) } catch {}
}

Write-Log 'installer dipanggil'

# ---------- naikkan ke admin (UAC) ----------
$identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdmin   = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  Write-Log 'belum elevated; relaunch via UAC'
  $argLine = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argLine
  exit
}

Write-Log 'elevated OK'

# ---------- kredensial akun rdpadmin ----------
$runAsUser = "$env:COMPUTERNAME\rdpadmin"
$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path $psExe)) { $psExe = 'powershell.exe' }

function Test-TaskCredential($c) {
  # Validasi password dengan mendaftarkan task uji sekali pakai.
  # Cara ini memakai jalur Register-ScheduledTask yang sama dengan task asli,
  # jadi password benar/salah langsung terdeteksi sebelum ada perubahan.
  $testName = 'BCODE-CRED-TEST'
  try {
    $cmd = Join-Path $env:SystemRoot 'System32\cmd.exe'
    $a = New-ScheduledTaskAction -Execute $cmd -Argument '/c exit 0'
    $t = New-ScheduledTaskTrigger -Once -At (Get-Date).AddYears(1)
    Register-ScheduledTask -TaskName $testName -Action $a -Trigger $t `
      -User $c.UserName -Password $c.GetNetworkCredential().Password `
      -RunLevel Limited -Force -ErrorAction Stop | Out-Null
    Unregister-ScheduledTask -TaskName $testName -Confirm:$false -ErrorAction SilentlyContinue
    return $true
  } catch {
    Unregister-ScheduledTask -TaskName $testName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Log "validasi kredensial gagal: $($_.Exception.Message)"
    return $false
  }
}

$cred = $null
$plainPassword = $null
for ($attempt = 1; $attempt -le 3; $attempt++) {
  $c = Get-Credential -UserName $runAsUser -Message "Percobaan $attempt/3. Masukkan password Windows akun $runAsUser (bukan PIN). Password disimpan terenkripsi oleh Windows Task Scheduler; tidak dikirim ke chat dan tidak ditulis ke log."
  if (-not $c) {
    Write-Log 'kredensial dibatalkan'
    Write-Host 'Dibatalkan. Tidak ada perubahan.'
    exit 1
  }
  if ($c.UserName -notlike '*rdpadmin') {
    Write-Host "User harus rdpadmin, bukan $($c.UserName). Coba lagi."
    Write-Log "user salah: $($c.UserName)"
    continue
  }
  $p = $c.GetNetworkCredential().Password
  if ([string]::IsNullOrEmpty($p)) {
    Write-Host 'Password kosong. Task sebelum login tidak bisa dibuat. Coba lagi.'
    Write-Log 'password kosong'
    continue
  }

  Write-Host "Memeriksa kredensial (percobaan $attempt/3)..."
  if (Test-TaskCredential $c) {
    $cred = $c
    $plainPassword = $p
    Write-Log "kredensial diterima untuk $($cred.UserName) (password tidak dicatat)"
    break
  }

  Write-Host 'Password ditolak Windows. Gunakan password akun Windows (bukan PIN), periksa Caps Lock, lalu coba lagi.'
}

if (-not $cred) {
  Write-Host 'Kredensial gagal 3 kali. Tidak ada perubahan.'
  Write-Log 'kredensial gagal 3 kali'
  exit 1
}

function New-WorkerAction([string]$script, [string]$workdir) {
  return New-ScheduledTaskAction -Execute $psExe -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`"" -WorkingDirectory $workdir
}

function New-BootTrigger([string]$delay) {
  $t = New-ScheduledTaskTrigger -AtStartup
  $t.Delay = $delay
  return $t
}

function New-WorkerSettings {
  return New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew
}

function New-WatchdogSettings {
  return New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew
}

$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$backupFile = Join-Path $bootDir 'autostart-backup.json'

# ---------- buat task ----------
$created = @()
try {
  # 1) iPos API KEFA
  $iposAction  = New-WorkerAction (Join-Path $bootDir 'start-ipos.ps1') 'C:\Users\rdpadmin\ipos-api'
  $iposTrigger = New-BootTrigger 'PT20S'
  Register-ScheduledTask `
    -TaskName 'BCODE-KEFA-IPOS' `
    -Action $iposAction `
    -Trigger $iposTrigger `
    -Settings (New-WorkerSettings) `
    -User $cred.UserName `
    -Password $plainPassword `
    -RunLevel Limited `
    -Description 'iPos API KEFA port 8080. Start saat boot sebelum login.' `
    -Force | Out-Null
  $created += 'BCODE-KEFA-IPOS'
  Write-Log 'task BCODE-KEFA-IPOS dibuat'

  # 2) Bot Telegram + dashboard
  $botAction  = New-WorkerAction (Join-Path $bootDir 'start-bot.ps1') $root
  $botTrigger = New-BootTrigger 'PT45S'
  Register-ScheduledTask `
    -TaskName 'BCODE-KEFA-BOT' `
    -Action $botAction `
    -Trigger $botTrigger `
    -Settings (New-WorkerSettings) `
    -User $cred.UserName `
    -Password $plainPassword `
    -RunLevel Limited `
    -Description 'Bot Telegram BCODE-KEFA + dashboard port 3001. Start saat boot sebelum login.' `
    -Force | Out-Null
  $created += 'BCODE-KEFA-BOT'
  Write-Log 'task BCODE-KEFA-BOT dibuat'

  # 3) Watchdog
  $wdAction = New-WorkerAction (Join-Path $bootDir 'watchdog-boot.ps1') $root
  $wdBoot   = New-BootTrigger 'PT2M'
  $wdRepeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) `
    -RepetitionInterval (New-TimeSpan -Minutes 1) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
  $wdRepeat.Repetition.StopAtDurationEnd = $false

  Register-ScheduledTask `
    -TaskName 'BCODE-KEFA-WATCHDOG' `
    -Action $wdAction `
    -Trigger @($wdBoot, $wdRepeat) `
    -Settings (New-WatchdogSettings) `
    -User $cred.UserName `
    -Password $plainPassword `
    -RunLevel Highest `
    -Description 'Cek health bot 3001 + iPos 8080 tiap 1 menit; restart task bila gagal.' `
    -Force | Out-Null
  $created += 'BCODE-KEFA-WATCHDOG'
  Write-Log 'task BCODE-KEFA-WATCHDOG dibuat'

  # ---------- backup + ganti autostart login ----------
  $oldRun = Get-ItemProperty -Path $runKey -ErrorAction SilentlyContinue
  $backup = [ordered]@{
    savedAt = (Get-Date).ToString('s')
    user    = $env:USERNAME
    PM2     = if ($oldRun) { $oldRun.PM2 } else { $null }
    iPosAPI = if ($oldRun) { $oldRun.iPosAPI } else { $null }
  }
  $backup | ConvertTo-Json -Depth 3 | Set-Content -Path $backupFile -Encoding UTF8
  Write-Log "backup autostart lama: $backupFile"

  $hidden       = Join-Path $bootDir 'run-hidden.vbs'
  $botFallback  = Join-Path $bootDir 'start-bot-if-needed.ps1'
  $iposFallback = Join-Path $bootDir 'start-ipos-if-needed.ps1'

  Set-ItemProperty -Path $runKey -Name 'PM2' -Value "wscript.exe `"$hidden`" `"$botFallback`""
  Set-ItemProperty -Path $runKey -Name 'iPosAPI' -Value "wscript.exe `"$hidden`" `"$iposFallback`""
  Write-Log 'HKCU Run PM2/iPosAPI diganti fallback health-gated'

  # ---------- matikan watchdog lama yang rusak (tetap bisa di-enable untuk rollback) ----------
  $oldWatchdog = Get-ScheduledTask -TaskName 'Watchdog-Bot-Telegram' -ErrorAction SilentlyContinue
  if ($oldWatchdog) {
    Stop-ScheduledTask  -TaskName 'Watchdog-Bot-Telegram' -ErrorAction SilentlyContinue
    Disable-ScheduledTask -TaskName 'Watchdog-Bot-Telegram' -ErrorAction SilentlyContinue | Out-Null
    Write-Log 'Watchdog-Bot-Telegram lama dihentikan + disabled'
  }

  # ---------- verifikasi XML ----------
  foreach ($name in $created) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction Stop
    $xml  = $task | Export-ScheduledTask
    if ($xml -notmatch '<BootTrigger>') { throw "$name tidak memiliki BootTrigger" }
    if ($xml -notmatch '<LogonType>Password</LogonType>') { throw "$name bukan Password logon" }
    Write-Host ("OK  {0}  state={1}" -f $name, $task.State)
    Write-Log ("verifikasi OK {0} state={1}" -f $name, $task.State)
  }

  # ---------- uji jalankan task tanpa mengganggu proses yang sehat ----------
  # Wrapper start-bot/start-ipos akan langsung exit 0 bila health sudah OK,
  # jadi PM2/iPos/bot yang sedang jalan tidak diubah.
  Start-ScheduledTask -TaskName 'BCODE-KEFA-IPOS'
  Start-Sleep -Seconds 5
  Start-ScheduledTask -TaskName 'BCODE-KEFA-BOT'
  Start-Sleep -Seconds 5
  Start-ScheduledTask -TaskName 'BCODE-KEFA-WATCHDOG'
  Start-Sleep -Seconds 8

  foreach ($name in $created) {
    $info = Get-ScheduledTaskInfo -TaskName $name -ErrorAction SilentlyContinue
    $res  = if ($info) { $info.LastTaskResult } else { 'n/a' }
    Write-Host ("TEST {0}  lastResult={1}" -f $name, $res)
    Write-Log ("test {0} lastResult={1}" -f $name, $res)
    if ($res -eq 2147943726) { throw "$name gagal logon (password salah?)" }
  }

  Write-Host ''
  Write-Host 'SELESAI. Task boot sudah terpasang.'
  Write-Host 'Bot/iPos yang sekarang TIDAK dimatikan. Saat reboot, task akan start sebelum login.'
  Write-Host 'Setelah reboot, cek: C:\BOT-TELEGRAM-\logs\boot-events.log'
  Write-Host 'Rollback: C:\BOT-TELEGRAM-\boot\rollback-boot-tasks.ps1 (run as admin).'
  Write-Log 'SELESAI: task boot terpasang, bot lama tetap jalan'
}
catch {
  Write-Log "GAGAL: $($_.Exception.Message)"
  Write-Host ''
  Write-Host ("GAGAL: " + $_.Exception.Message)
  Write-Host 'Mengembalikan autostart lama dan menghapus task baru...'

  # Kembalikan HKCU Run dari backup jika sudah ada.
  try {
    if (Test-Path $backupFile) {
      $b = Get-Content $backupFile -Raw | ConvertFrom-Json
      if ($null -ne $b.PM2) {
        Set-ItemProperty -Path $runKey -Name 'PM2' -Value $b.PM2
      } else {
        Remove-ItemProperty -Path $runKey -Name 'PM2' -ErrorAction SilentlyContinue
      }
      if ($null -ne $b.iPosAPI) {
        Set-ItemProperty -Path $runKey -Name 'iPosAPI' -Value $b.iPosAPI
      } else {
        Remove-ItemProperty -Path $runKey -Name 'iPosAPI' -ErrorAction SilentlyContinue
      }
      Write-Log 'autostart lama dikembalikan'
    }
  } catch {
    Write-Log "gagal restore autostart: $($_.Exception.Message)"
  }

  foreach ($name in $created) {
    Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
    Write-Log "task $name dihapus karena gagal"
  }

  # Jika kegagalan terjadi setelah watchdog lama di-disable, aktifkan lagi.
  Enable-ScheduledTask -TaskName 'Watchdog-Bot-Telegram' -ErrorAction SilentlyContinue | Out-Null

  $plainPassword = $null
  exit 1
}

$plainPassword = $null
Write-Host 'Tekan Enter untuk menutup.'
Read-Host | Out-Null

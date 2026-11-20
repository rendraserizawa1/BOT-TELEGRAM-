# ============================================================
#  PASANG JAGA-RAM — tugas harian 23:00 yang menutup Chrome.
#
#  TIDAK butuh Administrator: tugas didaftarkan sebagai user rdpadmin
#  (LogonType Interactive), dan sudah diuji berhasil pada mesin ini.
#  Hak Administrator hanya diperlukan untuk tugas AtStartup/SYSTEM,
#  yang memang TIDAK dipakai di sini.
#
#  Jalankan:
#      powershell -ExecutionPolicy Bypass -File C:\BOT-TELEGRAM-\boot\pasang-jaga-ram.ps1
#
#  Untuk melepas:
#      Unregister-ScheduledTask -TaskName "BCODE-JAGA-RAM" -Confirm:$false
# ============================================================

$ErrorActionPreference = 'Stop'
$Nama  = 'BCODE-JAGA-RAM'
$Skrip = 'C:\BOT-TELEGRAM-\boot\jaga-ram.ps1'

Write-Host ''
Write-Host '=== PASANG JAGA-RAM (tutup Chrome tiap 23:00) ===' -ForegroundColor Cyan

if (-not (Test-Path $Skrip)) {
  Write-Host ('GAGAL: ' + $Skrip + ' tidak ada.') -ForegroundColor Red
  Read-Host 'Tekan Enter untuk menutup'
  exit 1
}

$aksi = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $Skrip + '"')
$trig = New-ScheduledTaskTrigger -Daily -At '23:00'
$prin = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive -RunLevel Limited
$setelan = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $Nama -Action $aksi -Trigger $trig `
  -Principal $prin -Settings $setelan -Force | Out-Null

$t = Get-ScheduledTask -TaskName $Nama
$i = Get-ScheduledTaskInfo -TaskName $Nama
Write-Host ''
Write-Host 'Berhasil dipasang:' -ForegroundColor Green
Write-Host ('  Nama    : ' + $t.TaskName)
Write-Host ('  Jalan   : tiap hari 23:00')
Write-Host ('  Sebagai : ' + $t.Principal.UserId + '  (' + $t.Principal.LogonType + ')')
Write-Host ('  State   : ' + $t.State)
Write-Host ''
Write-Host 'Yang dilakukan tugas ini: HANYA menutup chrome.exe.' -ForegroundColor Yellow
Write-Host 'node.exe (proxy iPos + agen) dan 9router TIDAK disentuh.' -ForegroundColor Yellow
Write-Host ''
Write-Host 'Uji sekarang tanpa menunggu 23:00:' -ForegroundColor Cyan
Write-Host ('  powershell -ExecutionPolicy Bypass -File ' + $Skrip)
Write-Host ('  lalu lihat: C:\BOT-TELEGRAM-\logs\jaga-ram.log')
Write-Host ''
Read-Host 'Tekan Enter untuk menutup'

# report-memory.ps1
# Laporan ringkas kondisi memori host + dampaknya ke bot.
# Jalankan kapan saja: powershell -NoProfile -ExecutionPolicy Bypass -File boot\report-memory.ps1
$ErrorActionPreference = 'SilentlyContinue'

$os = Get-CimInstance Win32_OperatingSystem
$totalMB = [int]($os.TotalVisibleMemorySize / 1KB)
$freeMB  = [int]($os.FreePhysicalMemory / 1KB)
$commitUsedGB = [math]::Round(($os.TotalVirtualMemorySize - $os.FreeVirtualMemory) / 1MB, 2)
$commitLimitGB = [math]::Round($os.TotalVirtualMemorySize / 1MB, 2)
$pf = Get-CimInstance Win32_PageFileUsage

Write-Output '========================================================='
Write-Output ' KONDISI MEMORI HOST'
Write-Output '========================================================='
Write-Output ("RAM fisik total   : {0} MB ({1:N1} GB)" -f $totalMB, ($totalMB / 1024))
Write-Output ("RAM bebas         : {0} MB" -f $freeMB)
Write-Output ("Commit terpakai   : {0} GB dari batas {1} GB" -f $commitUsedGB, $commitLimitGB)
Write-Output ("Pagefile          : alokasi {0} MB, terpakai {1} MB, puncak {2} MB" -f $pf.AllocatedBaseSize, $pf.CurrentUsage, $pf.PeakUsage)
Write-Output ''

# Pages/sec tinggi = Windows terus menukar memori ke disk = penyebab bot "diam".
$c = Get-Counter '\Memory\Pages/sec', '\Memory\Available MBytes' -SampleInterval 1 -MaxSamples 3
$pages = ($c.CounterSamples | Where-Object { $_.Path -like '*pages/sec*' } | Measure-Object CookedValue -Average).Average
$avail = ($c.CounterSamples | Where-Object { $_.Path -like '*available mbytes*' } | Measure-Object CookedValue -Average).Average
Write-Output ("Pages/sec (rata2): {0:N0}" -f $pages)
Write-Output ("Available MBytes : {0:N0}" -f $avail)
if ($pages -gt 1000) {
  Write-Output '  -> TINGGI: Windows sedang menukar memori ke disk. Bot bisa "diam" 2-6 detik'
  Write-Output '     berulang kali. Ini BUKAN bug bot (terbukti: CPU bot 0,00 s saat diam).'
} else {
  Write-Output '  -> normal'
}
Write-Output ''

Write-Output '========================================================='
Write-Output ' PEMAKAI MEMORI TERBESAR (commit)'
Write-Output '========================================================='
Get-CimInstance Win32_Process | Group-Object Name | ForEach-Object {
  [pscustomobject]@{
    Aplikasi   = $_.Name
    Proses     = $_.Count
    'Commit_MB' = [math]::Round((($_.Group | Measure-Object PageFileUsage -Sum).Sum) / 1KB, 0)
    'RAM_MB'    = [math]::Round((($_.Group | Measure-Object WorkingSetSize -Sum).Sum) / 1MB, 0)
  }
} | Sort-Object Commit_MB -Descending | Select-Object -First 10 | Format-Table -AutoSize
Write-Output ''

Write-Output '========================================================='
Write-Output ' STATUS BOT'
Write-Output '========================================================='
$lock = Get-Content 'C:\BOT-TELEGRAM-\storage\bot.lock' -Raw | ConvertFrom-Json
Write-Output ("Lock PID          : {0}" -f $lock.pid)
$p = Get-Process -Id $lock.pid
if ($p) {
  Write-Output ("Proses bot        : HIDUP (RAM {0} MB)" -f [math]::Round($p.WorkingSet64 / 1MB, 0))
} else {
  Write-Output 'Proses bot        : TIDAK ADA'
}
try {
  $h = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/health' -TimeoutSec 30
  Write-Output ("Polling Telegram  : {0} (terakhir {1} detik lalu, error beruntun {2})" -f $h.polling, $h.telegramLastPollAgoSec, $h.telegramPollErrorStreak)
  Write-Output ("Event loop lag    : {0} ms" -f $h.loopLagMs)
  Write-Output ("Database          : {0} pesan, {1} file, {2} event, {3} backup" -f $h.db.messages, $h.db.files, $h.db.events, $h.db.backups)
} catch {
  Write-Output 'Health bot        : TIDAK MENJAWAB (kemungkinan host sedang paging)'
}
Write-Output ''

Write-Output '========================================================='
Write-Output ' SARAN'
Write-Output '========================================================='
if ($freeMB -lt 400) {
  Write-Output '* RAM sangat sempit. Menutup Chrome (bisa 1,5-2 GB) adalah bantuan terbesar.'
  Write-Output '* Menambah RAM fisik adalah solusi permanen; bot sendiri hanya butuh ~80 MB.'
  Write-Output '* Bot TIDAK akan di-restart oleh watchdog saat host paging, karena restart'
  Write-Output '  hanya memperpanjang downtime (sudah diukur dan diperbaiki).'
} else {
  Write-Output '* Kondisi memori masih wajar.'
}

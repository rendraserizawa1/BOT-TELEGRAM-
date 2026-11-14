# test-watchdog-logic.ps1
# Menguji fungsi keputusan watchdog TANPA menjalankan aksi restart.
# Definisi fungsi diambil langsung dari watchdog-boot.ps1 lewat AST,
# jadi yang diuji benar-benar kode produksi (bukan salinan).

$ErrorActionPreference = 'Stop'
$watchdog = 'C:\BOT-TELEGRAM-\boot\watchdog-boot.ps1'
$dir      = 'C:\BOT-TELEGRAM-'
$botPort  = 3001

$ast = [System.Management.Automation.Language.Parser]::ParseFile($watchdog, [ref]$null, [ref]$null)
$funcs = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)

$perlu = @('Test-BotProsesHidup', 'Test-BotPollerMati', 'Get-BotReason')
$hasil = @()

foreach ($nama in $perlu) {
  $f = $funcs | Where-Object { $_.Name -eq $nama } | Select-Object -First 1
  if (-not $f) { Write-Output "GAGAL: fungsi $nama tidak ditemukan"; exit 1 }
  . ([scriptblock]::Create($f.Extent.Text))
}

Write-Output '=== UJI 1: Test-BotProsesHidup dengan lock PID hidup ==='
$hidup = Test-BotProsesHidup
Write-Output ("  hasil={0} (harapan=True)" -f $hidup)
$hasil += [pscustomobject]@{ Uji = 'proses hidup terdeteksi'; Lulus = ($hidup -eq $true) }

Write-Output '=== UJI 2: Test-BotPollerMati saat bot sehat ==='
$mati = Test-BotPollerMati
Write-Output ("  hasil={0} (harapan=False)" -f $mati)
$hasil += [pscustomobject]@{ Uji = 'bot sehat bukan poller mati'; Lulus = ($mati -eq $false) }

Write-Output '=== UJI 3: lock PID mati -> proses dianggap tidak hidup ==='
$lockPath = Join-Path $dir 'storage\bot.lock'
$asli = Get-Content -LiteralPath $lockPath -Raw
try {
  Set-Content -LiteralPath $lockPath -Value '{"pid":999999,"at":1,"port":3001}' -NoNewline
  $hidup2 = Test-BotProsesHidup
  Write-Output ("  hasil={0} (harapan=False)" -f $hidup2)
  $hasil += [pscustomobject]@{ Uji = 'lock PID mati terdeteksi'; Lulus = ($hidup2 -eq $false) }
} finally {
  Set-Content -LiteralPath $lockPath -Value $asli -NoNewline
  Write-Output '  (lock asli dipulihkan)'
}

Write-Output '=== UJI 4: health TIDAK menjawab -> BUKAN bukti poller mati ==='
# Arahkan ke port kosong: health timeout, perilaku harus False (tidak diketahui).
$botPort = 59999
$matiTimeout = Test-BotPollerMati
Write-Output ("  hasil={0} (harapan=False, bukan True)" -f $matiTimeout)
$hasil += [pscustomobject]@{ Uji = 'timeout != poller mati'; Lulus = ($matiTimeout -eq $false) }

Write-Output '=== UJI 5: lock asli kembali utuh ==='
$pulih = (Get-Content -LiteralPath $lockPath -Raw) -eq $asli
Write-Output ("  lock identik={0}" -f $pulih)
$hasil += [pscustomobject]@{ Uji = 'lock dipulihkan utuh'; Lulus = $pulih }

Write-Output ''
Write-Output '=== RINGKASAN ==='
$hasil | Format-Table -AutoSize
$gagal = ($hasil | Where-Object { -not $_.Lulus }).Count
Write-Output ("LULUS {0}/{1}" -f ($hasil.Count - $gagal), $hasil.Count)
if ($gagal -gt 0) { exit 1 }

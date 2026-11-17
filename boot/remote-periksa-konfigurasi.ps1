$ErrorActionPreference = 'Continue'

Write-Output '=== FOLDER KERJA PROXY CP ==='
$p = Get-CimInstance Win32_Process -Filter 'ProcessId=4700'
$induk = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $p.ParentProcessId)
Write-Output ('induk PID ' + $induk.ProcessId + ' : ' + $induk.CommandLine)
Write-Output ''

# Cari folder yang berisi server.js + .env
$kandidat = @()
foreach ($d in @('C:\ipos-api', 'C:\Users\kassa\ipos-api', 'C:\Users\kassa\Desktop\ipos-api', 'C:\ipos', 'C:\proxy')) {
  if (Test-Path $d) { $kandidat += $d }
}
Get-ChildItem C:\ -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  $s = Join-Path $_.FullName 'server.js'
  if (Test-Path $s) { $kandidat += $_.FullName }
}
Get-ChildItem C:\Users\kassa -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  $s = Join-Path $_.FullName 'server.js'
  if (Test-Path $s) { $kandidat += $_.FullName }
}
$kandidat = $kandidat | Select-Object -Unique
Write-Output '=== KANDIDAT FOLDER PROXY ==='
$kandidat | ForEach-Object { Write-Output ('  ' + $_) }

foreach ($d in $kandidat) {
  $envf = Join-Path $d '.env'
  if (-not (Test-Path $envf)) { continue }
  Write-Output ''
  Write-Output ('=== KONFIGURASI: ' + $envf + ' (password TIDAK dicetak) ===')
  Get-Content $envf | ForEach-Object {
    $baris = $_.Trim()
    if ($baris -eq '' -or $baris.StartsWith('#')) { return }
    if ($baris -match '^(PGPASSWORD|API_KEY|KEY|TOKEN|SECRET)\s*=') {
      $nama = ($baris -split '=')[0]
      $nilai = ($baris -split '=', 2)[1]
      Write-Output ('  ' + $nama + ' = <disembunyikan, panjang ' + $nilai.Length + '>')
    } else {
      Write-Output ('  ' + $baris)
    }
  }
  Write-Output ''
  Write-Output '  --- versi server.js ---'
  Write-Output ('  ukuran: ' + (Get-Item (Join-Path $d 'server.js')).Length + ' byte')
  Write-Output ('  diubah: ' + (Get-Item (Join-Path $d 'server.js')).LastWriteTime)
  $ada = Select-String -Path (Join-Path $d 'server.js') -Pattern 'normJual' -SimpleMatch -ErrorAction SilentlyContinue
  Write-Output ('  punya normJual: ' + $(if ($ada) { 'YA (' + @($ada).Count + ' tempat)' } else { 'TIDAK' }))
  $pg = Select-String -Path (Join-Path $d 'server.js') -Pattern 'new pg.Pool|new Pool' -ErrorAction SilentlyContinue
  Write-Output ('  jumlah Pool: ' + @($pg).Count)
}

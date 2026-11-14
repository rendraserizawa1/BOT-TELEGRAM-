$ErrorActionPreference = 'SilentlyContinue'

# Fallback saat user login (HKCU Run) untuk iPos API KEFA port 8080.
# Jika task BCODE-KEFA-IPOS sudah menyalakan API, script ini tidak
# menjalankan instance kedua.

$log    = 'C:\BOT-TELEGRAM-\logs\logon-fallback.log'
$health = 'http://127.0.0.1:8080/ipos/health'
$vbs    = 'C:\Users\rdpadmin\ipos-api\run-ipos-api.vbs'

New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 524288)) {
  Get-Content $log -Tail 300 | Set-Content $log
}

function Write-Log([string]$m) {
  try { Add-Content $log ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) } catch {}
}

function Test-IposReady {
  try {
    $r = Invoke-RestMethod -Uri $health -TimeoutSec 5
    return ($null -ne $r -and $r.ok -eq $true)
  } catch {
    return $false
  }
}

for ($i = 0; $i -lt 18; $i++) {
  if (Test-IposReady) {
    Write-Log 'ipos api sudah sehat; fallback login tidak perlu start'
    exit 0
  }
  Start-Sleep -Seconds 5
}

Write-Log 'ipos api belum sehat setelah 90 detik; fallback VBS'
if (Test-Path $vbs) {
  Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$vbs`"" -WindowStyle Hidden
} else {
  Write-Log "VBS tidak ditemukan: $vbs"
}
exit 0

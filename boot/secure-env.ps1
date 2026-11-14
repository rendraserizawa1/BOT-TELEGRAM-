$ErrorActionPreference = 'Stop'

# Salin .env ke folder aman TANPA membaca/menampilkan isinya.
# Tujuan: kredensial tetap ada walau file utama tidak sengaja terhapus.
$root = 'C:\BOT-TELEGRAM-'
$src  = Join-Path $root '.env'
$dir  = Join-Path $root 'data\secure'
$dst  = Join-Path $dir 'env.backup'

New-Item -ItemType Directory -Force -Path $dir | Out-Null
if (-not (Test-Path -LiteralPath $src)) {
  Write-Output 'ENV_MISSING'
  exit 1
}

Copy-Item -LiteralPath $src -Destination $dst -Force
$user = whoami
# Hanya user bot, SYSTEM, dan Administrators yang boleh membaca.
& icacls $dir /inheritance:r /grant:r "${user}:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" | Out-Null
& icacls $dst /inheritance:r /grant:r "${user}:F" "*S-1-5-18:F" "*S-1-5-32-544:F" | Out-Null

$size = (Get-Item -LiteralPath $dst).Length
Write-Output "ENV_BACKUP_OK size=$size"

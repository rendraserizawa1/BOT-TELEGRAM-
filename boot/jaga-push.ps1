# Wrapper task BCODE-JAGA-PUSH.
# Menjalankan penjaga agen dorong (boot/jaga-push.js) yang memastikan agen
# dorong iPos hidup terus dan hanya ada SATU.
#
# Skrip ini TIDAK menjalankan bot Telegram dan TIDAK menyentuh proxy iPos.
# Ia hanya menjaga proses pengirim data.
#
# Konfigurasi dibaca dari boot\push-agen.env (diabaikan git) lalu dari .env.
# NILAI RAHASIA TIDAK PERNAH DICETAK â€” hanya panjangnya, agar log aman.

$ErrorActionPreference = 'Continue'

$dir     = 'C:\BOT-TELEGRAM-'
$node    = 'C:\Program Files\nodejs\node.exe'
$skrip   = Join-Path $dir 'boot\jaga-push.js'
$logDir  = Join-Path $dir 'logs'
$log     = Join-Path $logDir 'jaga-push.log'
$envPush = Join-Path $dir 'boot\push-agen.env'
$envFile = Join-Path $dir '.env'

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

try {
  if ((Test-Path $log) -and ((Get-Item $log).Length -gt 5MB)) {
    Move-Item -LiteralPath $log -Destination "$log.1" -Force
  }
} catch {}

function Tulis([string]$m) {
  try { Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) } catch {}
}

if (-not (Test-Path $skrip)) {
  Tulis "GAGAL: $skrip tidak ada"
  exit 1
}
if (-not (Test-Path $node)) { $node = 'node' }

# Muat konfigurasi.
#
# URUTAN & PRIORITAS — INI PERNAH MENYEBABKAN KESALAHAN SENYAP
# -----------------------------------------------------------
# Dulu nilai hanya diisi "kalau belum ada di env". Akibatnya sebuah wrapper
# yang sudah lama hidup (mis. tertinggal setelah agen dimatikan manual) terus
# mewariskan konfigurasi LAMA ke penjaga dan agen yang ia nyalakan — walau file
# sudah diperbarui. Pernah terjadi: file berisi `PUSH_TOKO=cp,nk,kefa` tetapi
# agen tetap hanya mendorong `kefa`, karena env proses menang atas file.
#
# Sekarang: push-agen.env adalah SUMBER KEBENARAN dan SELALU menimpa env
# (wrapper adalah pintu masuk produksi, jadi ia yang menentukan konfigurasi).
# .env hanya mengisi variabel yang belum ada, sehingga alamat tunnel di .env
# tidak pernah menimpa alamat tailnet di push-agen.env.
$namaSah = @('PUSH_URL','PUSH_TOKEN','PUSH_TOKO','PUSH_JEDA_PENUH_MS',
             'PUSH_JEDA_STOK_MS','PUSH_JEDA_LAPORAN_MS',
             'PUSH_JEDA_STOK_MS_CP','PUSH_JEDA_STOK_MS_NK',
             'PUSH_JEDA_LAPORAN_MS_CP','PUSH_JEDA_LAPORAN_MS_NK',
             'PUSH_JEDA_MEREK_MS_CP','PUSH_JEDA_MEREK_MS_NK',
             'PUSH_JEDA_MARKETPLACE_MS_CP','PUSH_JEDA_MARKETPLACE_MS_NK',
             'IPOS_URL','IPOS_KEY','IPOS_NK_URL','IPOS_NK_KEY',
             'IPOS_KEFA_URL','IPOS_KEFA_KEY')

foreach ($berkas in @($envPush, $envFile)) {
  if (-not (Test-Path $berkas)) { continue }
  # push-agen.env menimpa; .env hanya mengisi yang kosong.
  $timpa = ($berkas -eq $envPush)
  foreach ($baris in Get-Content -LiteralPath $berkas) {
    if ($baris -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') {
      $nama = $Matches[1]
      $nilai = $Matches[2].Trim().Trim('"').Trim("'")
      if ($nama -in $namaSah) {
        if ($timpa -or -not [Environment]::GetEnvironmentVariable($nama)) {
          [Environment]::SetEnvironmentVariable($nama, $nilai, 'Process')
        }
      }
    }
  }
}

Tulis ("wrapper jaga-push mulai (pid=$PID) PUSH_URL=" + $env:PUSH_URL + " PUSH_TOKEN_len=" + $($env:PUSH_TOKEN.Length) + " PUSH_TOKO=" + $env:PUSH_TOKO)

for ($i = 1; $i -le 100000; $i++) {
  Tulis "menjalankan node jaga-push.js (percobaan $i)"
  try {
    # JANGAN pakai `*>>` di sini: di PowerShell 5.1 operator itu menulis
    # UTF-16LE, sehingga log berisi byte nol di antara huruf dan tidak terbaca
    # oleh alat lain (terbukti: log penuh "2 0 2 6 - 1 1 ..."). Pipe ke
    # Out-File -Encoding utf8 menghasilkan log yang bisa dibaca langsung.
    & $node $skrip 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
    Tulis "node berhenti exit=$LASTEXITCODE"
  } catch {
    Tulis ("node gagal: " + $_.Exception.Message)
  }
  Start-Sleep -Seconds 20
}

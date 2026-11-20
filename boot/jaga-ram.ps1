# ============================================================
#  JAGA-RAM — tutup Chrome di luar jam operasional.
#
#  LATAR (insiden 20/11/2026)
#  --------------------------
#  PC ini punya RAM 3,78 GB dan terpakai 92% (sisa 291-419 MB). Chrome
#  memakai ~947 MB dari jumlah itu. Pada 20/11 PC mati mendadak 5x.
#  Menutup Chrome malam hari mengembalikan ~900 MB dan menurunkan
#  peluang crash saat toko buka pagi.
#
#  PENGAMAN (WAJIB — jangan dihapus)
#  ---------------------------------
#  Skrip ini HANYA mematikan proses bernama chrome.exe.
#  Ia TIDAK PERNAH menyentuh:
#    - node.exe  (proxy iPos, push-agen, jaga-push, jaga-poller)
#    - 9router   (alat AI pemilik PC)
#    - MsMpEng   (Windows Defender)
#  Daftar nama proses diambil dari daftar-putih, bukan daftar-hitam,
#  sehingga proses yang tidak dikenal tidak akan ikut terbunuh.
#
#  Dipasang oleh: boot\pasang-jaga-ram.ps1 (tugas harian 23:00)
#  Jalankan manual: powershell -ExecutionPolicy Bypass -File C:\BOT-TELEGRAM-\boot\jaga-ram.ps1
#
#  MODE UJI-COBA (tidak mematikan apa pun):
#      powershell -ExecutionPolicy Bypass -File C:\BOT-TELEGRAM-\boot\jaga-ram.ps1 -UjiCoba
# ============================================================

param(
  [switch]$UjiCoba
)

$ErrorActionPreference = 'Continue'

$dir    = 'C:\BOT-TELEGRAM-'
$logDir = Join-Path $dir 'logs'
$log    = Join-Path $logDir 'jaga-ram.log'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# Putar log kalau sudah besar.
try {
  if ((Test-Path $log) -and ((Get-Item $log).Length -gt 2MB)) {
    Move-Item -LiteralPath $log -Destination "$log.1" -Force
  }
} catch {}

function Tulis([string]$m) {
  try {
    Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m)
  } catch {}
}

function RAMBebasMB {
  try { return [Math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024, 0) }
  catch { return -1 }
}

# ── DAFTAR PUTIH: satu-satunya proses yang boleh dimatikan ──
$BOLEH_MATI = @('chrome')

$bebasAwal = RAMBebasMB
Tulis ('mulai: RAM bebas=' + $bebasAwal + ' MB' + $(if ($UjiCoba) { '  [MODE UJI-COBA: tidak ada yang dimatikan]' } else { '' }))

# ── 1. Pastikan proses agen hidup SEBELUM dan SESUDAH ───────
#     Kalau agen ikut mati, ini kegagalan serius dan harus tercatat.
function HitungAgen {
  $hasil = @{ 'push-agen' = 0; 'jaga-push' = 0; 'jaga-poller' = 0 }
  try {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
      $cl = [string]$_.CommandLine
      if ($cl -match 'push-agen')   { $hasil['push-agen']++ }
      elseif ($cl -match 'jaga-push')   { $hasil['jaga-push']++ }
      elseif ($cl -match 'jaga-poller') { $hasil['jaga-poller']++ }
    }
  } catch {}
  return $hasil
}

$agenSebelum = HitungAgen
Tulis ('agen sebelum: push-agen=' + $agenSebelum['push-agen'] + ' jaga-push=' + $agenSebelum['jaga-push'] + ' jaga-poller=' + $agenSebelum['jaga-poller'])

# ── 2. Matikan HANYA proses dalam daftar putih ──────────────
$dimatikan = 0
$mbDibebaskan = 0
foreach ($nama in $BOLEH_MATI) {
  $daftar = Get-Process -Name $nama -ErrorAction SilentlyContinue
  if (-not $daftar) { Tulis ($nama + ': tidak berjalan'); continue }

  $mb = [Math]::Round((($daftar | Measure-Object WorkingSet64 -Sum).Sum) / 1MB, 0)
  if ($UjiCoba) {
    Tulis ($nama + ': ' + $daftar.Count + ' proses, ' + $mb + ' MB -> AKAN ditutup (uji-coba: dilewati)')
    $mbDibebaskan += $mb
    continue
  }
  Tulis ($nama + ': ' + $daftar.Count + ' proses, ' + $mb + ' MB -> ditutup')

  foreach ($p in $daftar) {
    try { Stop-Process -Id $p.Id -Force -ErrorAction Stop; $dimatikan++ }
    catch { Tulis ('  gagal menutup pid ' + $p.Id + ': ' + $_.Exception.Message) }
  }
  $mbDibebaskan += $mb
}

Start-Sleep -Seconds 3
$bebasAkhir = RAMBebasMB

# ── 3. Pastikan agen TIDAK ikut mati ────────────────────────
$agenSesudah = HitungAgen
Tulis ('agen sesudah: push-agen=' + $agenSesudah['push-agen'] + ' jaga-push=' + $agenSesudah['jaga-push'] + ' jaga-poller=' + $agenSesudah['jaga-poller'])

$agenRusak = $false
foreach ($k in @('push-agen', 'jaga-push', 'jaga-poller')) {
  if ($agenSebelum[$k] -gt 0 -and $agenSesudah[$k] -eq 0) {
    $agenRusak = $true
    Tulis ('BAHAYA: ' + $k + ' HILANG setelah pembersihan (sebelum=' + $agenSebelum[$k] + ', sesudah=' + $agenSesudah[$k] + ')')
  }
}

Tulis ('selesai: ' + $dimatikan + ' proses ditutup, ~' + $mbDibebaskan + ' MB dibebaskan, RAM bebas ' + $bebasAwal + ' -> ' + $bebasAkhir + ' MB')

if ($agenRusak) {
  Tulis 'TINDAKAN: agen hilang - jalankan Start-ScheduledTask -TaskName BCODE-JAGA-PUSH'
  exit 2
}
exit 0

$ErrorActionPreference = 'Continue'

# Tugas sekali pakai (dijalankan watchdog sebagai Highest / elevated):
# menutup proses pemakan memori yang DIIZINKAN user, lalu menulis hasil ukur
# ke log. TIDAK menyentuh bot, iPos, opencode, atau proses lain.

$log = 'C:\BOT-TELEGRAM-\logs\free-memory.log'
function W([string]$m) {
  try { Add-Content $log ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) } catch {}
}

function Mem-Snapshot {
  $os = Get-CimInstance Win32_OperatingSystem
  return [pscustomobject]@{
    FreeRAM_MB = [int]($os.FreePhysicalMemory / 1KB)
    CommitUsed_GB = [math]::Round(($os.TotalVirtualMemorySize - $os.FreeVirtualMemory) / 1MB, 2)
  }
}

$before = Mem-Snapshot
W ("SEBELUM: FreeRAM={0}MB CommitUsed={1}GB" -f $before.FreeRAM_MB, $before.CommitUsed_GB)

# 1) Tutup Chrome (semua sesi, semua proses anak)
$chrome = Get-Process chrome -ErrorAction SilentlyContinue
$nChrome = ($chrome | Measure-Object).Count
if ($nChrome -gt 0) {
  $chrome | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 4
}
$sisaChrome = (Get-Process chrome -ErrorAction SilentlyContinue | Measure-Object).Count
W ("chrome: {0} proses ditutup, sisa {1}" -f $nChrome, $sisaChrome)

# 2) Excel SENGAJA TIDAK ditutup: user tidak mengizinkan, dan file Excel bisa
#    berisi pekerjaan yang belum disimpan.

Start-Sleep -Seconds 3
$after = Mem-Snapshot
W ("SESUDAH: FreeRAM={0}MB CommitUsed={1}GB" -f $after.FreeRAM_MB, $after.CommitUsed_GB)
W ("SELISIH: FreeRAM {0:+0;-0;0}MB, CommitUsed {1:+0.00;-0.00;0}GB" -f ($after.FreeRAM_MB - $before.FreeRAM_MB), ($after.CommitUsed_GB - $before.CommitUsed_GB))

# 3) Verifikasi bot tidak terganggu
try {
  $h = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/health' -TimeoutSec 25
  W ("bot: pid={0} polling={1} pollAgo={2}s streak={3}" -f $h.pid, $h.polling, $h.telegramLastPollAgoSec, $h.telegramPollErrorStreak)
} catch {
  W ("bot health ERROR: " + $_.Exception.Message)
}

# Hapus penanda agar tugas ini tidak berjalan lagi
Remove-Item -LiteralPath (Join-Path 'C:\BOT-TELEGRAM-\boot' 'free-memory-once.txt') -Force -ErrorAction SilentlyContinue
exit 0

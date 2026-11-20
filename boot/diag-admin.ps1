' ============================================================
'  DIAGNOSTIK BERHAK ADMIN — mengapa PC ini crash 12x/bulan
'
'  Skrip ini HANYA MEMBACA. Tidak mengubah satu setelan pun.
'  Hasil ditulis ke C:\BOT-TELEGRAM-\logs\diag-admin.txt
' ============================================================
$ErrorActionPreference = 'Continue'
$keluar = 'C:\BOT-TELEGRAM-\logs\diag-admin.txt'
New-Item -ItemType Directory -Force -Path (Split-Path $keluar) | Out-Null
$baris = New-Object System.Collections.Generic.List[string]
function T($m) { $baris.Add($m) }

T ('=== WAKTU: ' + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + ' ===')
T ('=== ADMIN: ' + ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) + ' ===')
T ''

# ── 1. KESEHATAN DISK ────────────────────────────────────────
T '=== 1. KESEHATAN DISK ==='
Get-PhysicalDisk -ErrorAction SilentlyContinue | ForEach-Object {
  T ('  ' + $_.FriendlyName + '  media=' + $_.MediaType + '  health=' + $_.HealthStatus + '  op=' + $_.OperationalStatus + '  size=' + [Math]::Round($_.Size/1GB,1) + 'GB')
}
T ''
T '  --- SMART predict failure ---'
try {
  Get-CimInstance -Namespace 'root/wmi' -ClassName MSStorageDriver_FailurePredictStatus -ErrorAction Stop | ForEach-Object {
    T ('  ' + $_.InstanceName + '  PredictFailure=' + $_.PredictFailure + '  Reason=' + $_.Reason)
  }
} catch { T ('  gagal: ' + $_.Exception.Message) }
T ''
T '  --- Disk reliability counters ---'
try {
  Get-PhysicalDisk -ErrorAction Stop | ForEach-Object {
    $c = $_ | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue
    if ($c) { T ('  ' + $_.FriendlyName + '  powerOnHours=' + $c.PowerOnHours + '  temperature=' + $c.Temperature + '  readErrTotal=' + $c.ReadErrorsTotal + '  writeErrTotal=' + $c.WriteErrorsTotal + '  wear=' + $c.Wear) }
  }
} catch { T ('  gagal: ' + $_.Exception.Message) }
T ''

# ── 2. ERROR HARDWARE ────────────────────────────────────────
T '=== 2. ERROR HARDWARE (WHEA) 30 HARI ==='
$whea = Get-WinEvent -FilterHashtable @{LogName='System'; StartTime=(Get-Date).AddDays(-30)} -ErrorAction SilentlyContinue |
  Where-Object { $_.ProviderName -match 'WHEA' }
if ($whea) { $whea | Select-Object -First 20 | ForEach-Object { T ('  ' + $_.TimeCreated.ToString('MM-dd HH:mm:ss') + ' id=' + $_.Id + ' ' + $_.ProviderName + ' ' + (($_.Message -split "`r?`n")[0].Trim())) } }
else { T '  TIDAK ADA error WHEA (tidak ada kerusakan hardware yang dilaporkan CPU/chipset)' }
T ''

# ── 3. RIWAYAT WINDOWS UPDATE DI SEKITAR CRASH ───────────────
T '=== 3. PEMBARUAN TERPASANG 30 HARI (kandidat penyebab restart) ==='
try {
  $q = Get-CimInstance -ClassName Win32_QuickFixEngineering -ErrorAction Stop | Where-Object { $_.InstalledOn -and ([datetime]$_.InstalledOn) -gt (Get-Date).AddDays(-30) }
  if ($q) { $q | ForEach-Object { T ('  ' + $_.HotFixID + '  terpasang=' + $_.InstalledOn) } } else { T '  tidak ada pembaruan 30 hari terakhir' }
} catch { T ('  gagal: ' + $_.Exception.Message) }
T ''

# ── 4. SLOT RAM (bisa ditambah?) ─────────────────────────────
T '=== 4. SLOT MEMORI (untuk menambah RAM) ==='
try {
  $papan = Get-CimInstance Win32_PhysicalMemoryArray -ErrorAction Stop
  $papan | ForEach-Object { T ('  slot total=' + $_.MemoryDevices + '  kapasitas maks=' + [Math]::Round($_.MaxCapacityEx/1MB,0) + ' MB') }
  Get-CimInstance Win32_PhysicalMemory -ErrorAction Stop | ForEach-Object {
    T ('  terisi: ' + $_.DeviceLocator + '  ' + [Math]::Round($_.Capacity/1GB,0) + 'GB  ' + $_.Speed + 'MT/s  ' + $_.Manufacturer + ' ' + $_.PartNumber)
  }
  $terpakai = (Get-CimInstance Win32_PhysicalMemory).Count
  T ('  slot terpakai: ' + $terpakai + ' dari ' + $papan[0].MemoryDevices)
} catch { T ('  gagal: ' + $_.Exception.Message) }
T ''

# ── 5. XML TUGAS PENJAGA (untuk rencana boot-start) ──────────
T '=== 5. XML TUGAS BCODE-JAGA-PUSH ==='
try {
  $x = Export-ScheduledTask -TaskName 'BCODE-JAGA-PUSH' -ErrorAction Stop
  T $x
} catch { T ('  gagal: ' + $_.Exception.Message) }
T ''

# ── 6. POWER / HIBERNASI / FAST STARTUP ──────────────────────
T '=== 6. SETELAN DAYA ==='
$hb = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -ErrorAction SilentlyContinue
T ('  HiberbootEnabled (Fast Startup) = ' + $hb.HiberbootEnabled)
try {
  $sub = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Power\PowerSettings\238C9FA8-0AAD-41ED-83F4-97BE242C8F20\7bc4a2f9-d8fc-4469-b07b-33eb785aaca0' -ErrorAction Stop).Attributes
  T ('  unattended sleep attributes = ' + $sub)
} catch {}
T ''
T '  --- pengaturan tidur/mati saat listrik ---'
powercfg /query SCHEME_CURRENT SUB_SLEEP 2>&1 | Select-String -Pattern 'GUID|Power Setting Index|Indeks' | ForEach-Object { T ('  ' + $_.Line.Trim()) }
T ''

# ── 7. APAKAH ADA MINIDUMP / MEMORY.DMP ──────────────────────
T '=== 7. DUMP CRASH (kalau ada, bisa dianalisis) ==='
foreach ($p in @('C:\Windows\MEMORY.DMP', 'C:\Windows\Minidump')) {
  if (Test-Path $p) {
    Get-ChildItem $p -ErrorAction SilentlyContinue | Select-Object -First 10 | ForEach-Object { T ('  ' + $_.FullName + '  ' + [Math]::Round($_.Length/1MB,1) + 'MB  ' + $_.LastWriteTime) }
  } else { T ('  tidak ada: ' + $p) }
}
T ''

# ── 8. SETELAN PAGEFILE ──────────────────────────────────────
T '=== 8. PAGEFILE ==='
$cs = Get-CimInstance Win32_ComputerSystem
T ('  AutomaticManagedPagefile = ' + $cs.AutomaticManagedPagefile)
Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue | ForEach-Object { T ('  ' + $_.Name + '  awal=' + $_.InitialSize + 'MB  maks=' + $_.MaximumSize + 'MB') }
T ''

# ── 9. PROSES PALING LAMA (bocor memori?) ────────────────────
T '=== 9. PROSES YANG PALING LAMA HIDUP ==='
Get-Process -ErrorAction SilentlyContinue | Sort-Object StartTime -ErrorAction SilentlyContinue |
  Select-Object -First 12 | ForEach-Object {
    $st = try { $_.StartTime.ToString('MM-dd HH:mm') } catch { '?' }
    T ('  ' + $_.ProcessName.PadRight(24) + ' pid=' + ([string]$_.Id).PadLeft(6) + '  mulai=' + $st + '  RAM=' + [Math]::Round($_.WorkingSet64/1MB,0) + 'MB')
  }

T ''
T '=== SELESAI ==='
$baris -join "`r`n" | Out-File -FilePath $keluar -Encoding utf8

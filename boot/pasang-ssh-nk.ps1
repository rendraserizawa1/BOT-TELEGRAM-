# ============================================================================
#  PASANG SSH DI KOMPUTER TOKO NK  (sama seperti yang dipakai di ADMIN_DIMAS)
#  Jalankan di komputer NK, PowerShell sebagai Administrator.
#  Aman diulang berkali-kali. TIDAK menyentuh proxy iPos di port 8080.
# ============================================================================

$ErrorActionPreference = 'Continue'
$KUNCI = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKmjGa4f5oKcQk2Irt0UjNrxGa2I7fXTYkKia5L9e/ru bcode-railway'

function Judul($t) { Write-Host ''; Write-Host ('=== ' + $t + ' ===') -ForegroundColor Cyan }
function Ok($t)    { Write-Host ('  [OK]   ' + $t) -ForegroundColor Green }
function Gagal($t) { Write-Host ('  [GAGAL] ' + $t) -ForegroundColor Red }
function Info($t)  { Write-Host ('  ' + $t) }

# --- 0. Identitas mesin (supaya saya tahu ini benar komputer NK) -------------
Judul '0. MESIN INI SIAPA'
Info ('nama komputer : ' + $env:COMPUTERNAME)
Info ('user sekarang : ' + [System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
Info ('Windows       : ' + (Get-CimInstance Win32_OperatingSystem).Caption)
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -ne '127.0.0.1' } |
  ForEach-Object { Info ('IP            : ' + $_.IPAddress + '  (' + $_.InterfaceAlias + ')') }

$admin = ([System.Security.Principal.WindowsPrincipal][System.Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Gagal 'PowerShell ini TIDAK berjalan sebagai Administrator.'
  Info 'Tutup, lalu klik kanan PowerShell -> "Run as administrator", jalankan lagi.'
  Read-Host 'Tekan Enter untuk keluar'; exit 1
}
Ok 'berjalan sebagai Administrator'

# --- 1. Pastikan proxy iPos TIDAK terganggu (catat dulu keadaannya) ----------
Judul '1. PROXY iPos SEBELUM APA PUN (hanya dicatat, tidak disentuh)'
$p8080 = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
if ($p8080) {
  foreach ($x in $p8080) {
    $pr = Get-Process -Id $x.OwningProcess -ErrorAction SilentlyContinue
    Ok ('port 8080 DIDENGARKAN oleh PID ' + $x.OwningProcess + ' (' + $pr.ProcessName + ') - jangan diapa-apakan')
  }
} else { Info 'port 8080 belum mendengarkan (proxy mungkin sedang mati - bukan urusan skrip ini)' }

# --- 2. Pasang OpenSSH Server ------------------------------------------------
Judul '2. PASANG OpenSSH SERVER'
$sshdExe = 'C:\Windows\System32\OpenSSH\sshd.exe'
$svc = Get-Service sshd -ErrorAction SilentlyContinue
if ($svc -and (Test-Path $sshdExe)) {
  Ok 'OpenSSH Server sudah terpasang'
} else {
  Info 'memasang dari Windows (butuh internet sebentar)...'
  try {
    Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.0.0' -ErrorAction Stop | Out-Null
    Ok 'OpenSSH Server terpasang'
  } catch {
    Gagal ('pemasangan gagal: ' + $_.Exception.Message)
    Info 'Coba: Settings -> Apps -> Optional Features -> Add -> "OpenSSH Server"'
    Read-Host 'Tekan Enter untuk keluar'; exit 1
  }
}

# --- 3. Nyalakan service + otomatis saat boot -------------------------------
Judul '3. SERVICE sshd'
try {
  Set-Service -Name sshd -StartupType Automatic -ErrorAction Stop
  Start-Service -Name sshd -ErrorAction Stop
  Start-Sleep -Seconds 2
  $s2 = Get-Service sshd
  Ok ('status: ' + $s2.Status + ', start: ' + $s2.StartType)
} catch {
  Gagal ('service gagal dinyalakan: ' + $_.Exception.Message)
}

# --- 4. Pasang KUNCI PUBLIK (inti dari semuanya) ----------------------------
Judul '4. PASANG KUNCI PUBLIK'
# Catatan: kalau user adalah anggota grup Administrators, Windows OpenSSH
# MENGABAIKAN ~/.ssh/authorized_keys dan hanya membaca
# C:\ProgramData\ssh\administrators_authorized_keys.
# Itu sebabnya ADMIN_DIMAS bisa saya masuki. Kita lakukan hal yang sama.

$dirAdm = 'C:\ProgramData\ssh'
if (-not (Test-Path $dirAdm)) { New-Item -ItemType Directory -Path $dirAdm -Force | Out-Null }
$fileAdm = Join-Path $dirAdm 'administrators_authorized_keys'

# Tulis/gabungkan tanpa duplikat
$isiLama = @()
if (Test-Path $fileAdm) { $isiLama = @(Get-Content $fileAdm) }
if ($isiLama -match [regex]::Escape($KUNCI.Split(' ')[1])) {
  Ok 'kunci sudah ada di administrators_authorized_keys'
} else {
  $baru = @($isiLama | Where-Object { $_.Trim() -ne '' }) + $KUNCI
  Set-Content -Path $fileAdm -Value $baru -Encoding ascii -Force
  Ok 'kunci ditambahkan ke administrators_authorized_keys'
}

# ACL: WAJIB. Tanpa ini sshd menolak berkasnya secara diam-diam.
try {
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true, $false)
  $acl.SetOwner([System.Security.Principal.NTAccount]'BUILTIN\Administrators')
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule('NT AUTHORITY\SYSTEM','FullControl','Allow')))
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators','FullControl','Allow')))
  Set-Acl -Path $fileAdm -AclObject $acl
  Ok 'izin berkas kunci sudah benar (SYSTEM + Administrators)'
} catch {
  Gagal ('gagal mengatur izin: ' + $_.Exception.Message)
}

# Cadangan: pasang juga di authorized_keys milik user yang sedang login
$fileUser = Join-Path $env:USERPROFILE '.ssh\authorized_keys'
$dirUser = Join-Path $env:USERPROFILE '.ssh'
if (-not (Test-Path $dirUser)) { New-Item -ItemType Directory -Path $dirUser -Force | Out-Null }
$isiU = @()
if (Test-Path $fileUser) { $isiU = @(Get-Content $fileUser) }
if ($isiU -match [regex]::Escape($KUNCI.Split(' ')[1])) {
  Ok ('kunci sudah ada di ' + $fileUser)
} else {
  $baruU = @($isiU | Where-Object { $_.Trim() -ne '' }) + $KUNCI
  Set-Content -Path $fileUser -Value $baruU -Encoding ascii -Force
  Ok ('kunci ditambahkan ke ' + $fileUser)
}

# --- 5. Firewall -------------------------------------------------------------
Judul '5. FIREWALL PORT 22'
$rule = Get-NetFirewallRule -DisplayName 'OpenSSH Server' -ErrorAction SilentlyContinue
if ($rule) {
  try {
    Enable-NetFirewallRule -DisplayName 'OpenSSH Server' -ErrorAction Stop
    Ok 'rule "OpenSSH Server" diaktifkan'
  } catch { Gagal ('gagal mengaktifkan rule: ' + $_.Exception.Message) }
} else {
  try {
    New-NetFirewallRule -DisplayName 'OpenSSH Server' -Direction Inbound -Protocol TCP -LocalPort 22 -Action Allow -ErrorAction Stop | Out-Null
    Ok 'rule firewall port 22 dibuat'
  } catch { Gagal ('gagal membuat rule: ' + $_.Exception.Message) }
}
# Pastikan hanya profil yang masuk akal; jangan diubah kalau sudah benar.
Get-NetFirewallRule -DisplayName 'OpenSSH Server' -ErrorAction SilentlyContinue |
  ForEach-Object { Info ('profil aktif: ' + $_.Profile + ' | enabled=' + $_.Enabled + ' | action=' + $_.Action) }

# --- 6. Verifikasi ----------------------------------------------------------
Judul '6. VERIFIKASI'
$svcEnd = Get-Service sshd -ErrorAction SilentlyContinue
if ($svcEnd -and $svcEnd.Status -eq 'Running') { Ok 'service sshd Running' } else { Gagal 'service sshd TIDAK Running' }

$dengar22 = Get-NetTCPConnection -LocalPort 22 -State Listen -ErrorAction SilentlyContinue
if ($dengar22) {
  Ok ('port 22 DIDENGARKAN oleh PID ' + $dengar22[0].OwningProcess)
} else {
  Gagal 'port 22 belum mendengarkan'
  Info 'Coba: Restart-Service sshd'
}

Info ''
Info 'Isi administrators_authorized_keys sekarang:'
Get-Content $fileAdm -ErrorAction SilentlyContinue | ForEach-Object {
  $bag = $_ -split '\s+'
  Info ('   ' + $bag[0] + ' ... ' + ($bag[$bag.Count-1]))
}

Info ''
Info 'Fingerprint kunci host mesin ini (kirimkan ke saya):'
$hk = & "$env:WINDIR\System32\OpenSSH\ssh-keygen.exe" -lf 'C:\ProgramData\ssh\ssh_host_ed25519_key.pub' 2>&1
Info ('   ' + ($hk | Out-String).Trim())

Info ''
Info 'Proxy iPos masih hidup? (tidak boleh berubah)'
$p8080b = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
if ($p8080b) { Ok ('port 8080 masih DIDENGARKAN oleh PID ' + $p8080b[0].OwningProcess) }
else { Info 'port 8080 tidak mendengarkan (memang sudah begitu dari awal)' }

# --- 7. Hasil akhir ---------------------------------------------------------
Judul 'SELESAI'
Write-Host '  Kalau semua bertanda [OK], beri tahu saya: "NK sudah" - saya akan langsung uji masuk.' -ForegroundColor Yellow
Write-Host '  Yang perlu Anda kirimkan ke saya: nama komputer + daftar IP di bagian 0.' -ForegroundColor Yellow
Write-Host ''
Read-Host 'Tekan Enter untuk menutup'

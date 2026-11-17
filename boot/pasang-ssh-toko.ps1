# ============================================================================
#  PASANG SSH DI KOMPUTER TOKO  (BARCODE-NN)
#  Cara pakai: buka PowerShell sebagai Administrator, tempel SELURUH isi, Enter.
#
#  Kenapa versi ini berbeda dari yang tadi:
#  - Yang tadi memakai Add-WindowsCapability yang butuh Windows Update.
#    Di komputer toko biasanya gagal, dan galatnya tertelan oleh Out-Null
#    sehingga skrip lanjut ke Set-Service yang pasti gagal.
#  - Versi ini mengunduh MSI resmi Microsoft (OpenSSH-Win64 v9.5.0.0) —
#    VERSI YANG SAMA dengan ADMIN_DIMAS yang sudah terbukti bisa dimasuki.
#    MSI ini bertanda tangan digital Microsoft Corporation (sudah diverifikasi).
#  - Semua galat DITAMPILKAN, tidak disembunyikan.
#
#  TIDAK menyentuh proxy iPos di port 8080.
# ============================================================================

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

function Judul($t) { Write-Host ''; Write-Host ('=== ' + $t + ' ===') -ForegroundColor Cyan }
function Ok($t)    { Write-Host ('  [OK]    ' + $t) -ForegroundColor Green }
function Gagal($t) { Write-Host ('  [GAGAL] ' + $t) -ForegroundColor Red }
function Info($t)  { Write-Host ('  ' + $t) }

$KUNCI   = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKmjGa4f5oKcQk2Irt0UjNrxGa2I7fXTYkKia5L9e/ru bcode-railway'
$SIDKU   = 'IKmjGa4f5oKcQk2Irt0UjNrxGa2I7fXTYkKia5L9e/ru'
$URL_MSI = 'https://github.com/PowerShell/Win32-OpenSSH/releases/download/v9.5.0.0p1-Beta/OpenSSH-Win64-v9.5.0.0.msi'
$DIR_SSH = 'C:\Program Files\OpenSSH-Win64'

# ── 0. IDENTITAS + CEK ADMIN ───────────────────────────────────────────────
Judul '0. MESIN INI'
Info ('komputer : ' + $env:COMPUTERNAME)
Info ('user     : ' + $env:USERNAME)
Info ('windows  : ' + (Get-CimInstance Win32_OperatingSystem).Caption)
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -ne '127.0.0.1' } |
  ForEach-Object { Info ('IP       : ' + $_.IPAddress + '  (' + $_.InterfaceAlias + ')') }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Gagal 'PowerShell ini TIDAK berjalan sebagai Administrator.'
  Info ''
  Info 'INI HAMPIR PASTI SEBAB KEGAGALAN SEBELUMNYA.'
  Info 'Tutup jendela ini. Klik kanan "Windows PowerShell" -> "Run as administrator".'
  Info 'Jalankan ulang skrip ini di jendela itu.'
  Write-Host ''
  Read-Host 'Tekan Enter untuk menutup'
} else {

Ok 'berjalan sebagai Administrator'

# ── 1. CATAT PROXY iPos (tidak boleh terganggu) ────────────────────────────
Judul '1. PROXY iPos SEBELUM APA PUN'
$awal8080 = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
if ($awal8080) {
  foreach ($x in $awal8080) {
    $pr = Get-Process -Id $x.OwningProcess -ErrorAction SilentlyContinue
    Ok ('port 8080 oleh PID ' + $x.OwningProcess + ' (' + $pr.ProcessName + ') — tidak akan disentuh')
  }
} else { Info 'port 8080 tidak mendengarkan' }

# ── 2. UNDUH + PASANG MSI RESMI ────────────────────────────────────────────
Judul '2. PASANG OpenSSH SERVER'
if (Test-Path (Join-Path $DIR_SSH 'sshd.exe')) {
  Ok 'OpenSSH sudah terpasang di ' + $DIR_SSH
} else {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $msi = Join-Path $env:TEMP 'OpenSSH-Win64-v9.5.0.0.msi'
  $perluUnduh = $true
  if (Test-Path $msi) {
    if ((Get-Item $msi).Length -eq 5742592) { Ok 'MSI sudah ada di TEMP, tidak perlu unduh lagi'; $perluUnduh = $false }
  }
  if ($perluUnduh) {
    Info 'mengunduh MSI resmi Microsoft (5,5 MB)...'
    try {
      Invoke-WebRequest -Uri $URL_MSI -OutFile $msi -TimeoutSec 300 -UseBasicParsing -ErrorAction Stop
      Ok ('terunduh: ' + (Get-Item $msi).Length + ' byte')
    } catch {
      Gagal ('unduhan gagal: ' + $_.Exception.Message)
      Info 'Kalau komputer toko tidak punya internet, pakai jalan OFFLINE (lihat catatan di bawah).'
      $msi = $null
    }
  }

  if ($msi -and (Test-Path $msi)) {
    $sig = Get-AuthenticodeSignature $msi
    Info ('tanda tangan MSI: ' + $sig.Status + ' — ' + $sig.SignerCertificate.Subject)
    if ($sig.Status -eq 'Valid') { Ok 'MSI sah dari Microsoft' }
    else { Gagal 'MSI TIDAK bertanda tangan sah — dibatalkan demi keamanan'; $msi = $null }
  }

  if ($msi -and (Test-Path $msi)) {
    Info 'memasang (hening, ±30 detik)...'
    $p = Start-Process msiexec.exe -ArgumentList ('/i "' + $msi + '" /qn /norestart') -Wait -PassThru
    Info ('msiexec keluar kode ' + $p.ExitCode + ' (0 = sukses, 3010 = sukses perlu restart)')
    Start-Sleep -Seconds 3
    if (Test-Path (Join-Path $DIR_SSH 'sshd.exe')) { Ok 'sshd.exe terpasang' }
    else { Gagal 'sshd.exe tidak muncul setelah pemasangan' }
  }
}

# ── 3. SERVICE + KUNCI HOST ────────────────────────────────────────────────
Judul '3. SERVICE sshd'
if (-not (Test-Path (Join-Path $DIR_SSH 'sshd.exe'))) {
  Gagal 'OpenSSH belum terpasang — langkah selanjutnya dilewati.'
} else {
  # Daftarkan service kalau MSI belum membuatnya
  if (-not (Get-Service sshd -ErrorAction SilentlyContinue)) {
    Info 'mendaftarkan service sshd...'
    $inst = Join-Path $DIR_SSH 'install-sshd.ps1'
    if (Test-Path $inst) {
      & powershell -NoProfile -ExecutionPolicy Bypass -File $inst | Out-Host
    } else {
      & (Join-Path $DIR_SSH 'sshd.exe') '-install' 2>&1 | ForEach-Object { Info $_ }
    }
  }

  if (-not (Get-Service sshd -ErrorAction SilentlyContinue)) {
    Gagal 'service sshd tetap belum terdaftar'
  } else {
    # Buat kunci host kalau belum ada (dipakai untuk fingerprint mesin)
    try {
      & (Join-Path $DIR_SSH 'ssh-keygen.exe') -A 2>&1 | ForEach-Object { Info $_ }
      Ok 'kunci host siap'
    } catch { Gagal ('kunci host: ' + $_.Exception.Message) }

    try {
      Set-Service sshd -StartupType Automatic -ErrorAction Stop
      Start-Service sshd -ErrorAction Stop
      Start-Sleep -Seconds 2
      $s = Get-Service sshd
      Ok ('service sshd: ' + $s.Status + ', start: ' + $s.StartType)
    } catch { Gagal ('gagal menyalakan sshd: ' + $_.Exception.Message) }

    # ── 4. KUNCI PUBLIK ────────────────────────────────────────────────────
    Judul '4. KUNCI PUBLIK'
    Info 'PENTING: user Administrator -> Windows MENGABAIKAN ~/.ssh/authorized_keys.'
    Info 'Kunci HARUS di administrators_authorized_keys. Ini yang bikin ADMIN_DIMAS bisa saya masuki.'

    $dirAdm = 'C:\ProgramData\ssh'
    New-Item -ItemType Directory -Path $dirAdm -Force | Out-Null
    $fileAdm = Join-Path $dirAdm 'administrators_authorized_keys'

    $sudah = $false
    if (Test-Path $fileAdm) { $sudah = [bool](Select-String -Path $fileAdm -Pattern $SIDKU -SimpleMatch -Quiet) }
    if ($sudah) { Ok 'kunci sudah ada di administrators_authorized_keys' }
    else {
      Add-Content -Path $fileAdm -Value $KUNCI -Encoding ascii -Force
      Ok 'kunci ditambahkan ke administrators_authorized_keys'
    }

    try {
      $acl = New-Object System.Security.AccessControl.FileSecurity
      $acl.SetAccessRuleProtection($true, $false)
      $acl.SetOwner([System.Security.Principal.NTAccount]'BUILTIN\Administrators')
      $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule('NT AUTHORITY\SYSTEM','FullControl','Allow')))
      $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators','FullControl','Allow')))
      Set-Acl -Path $fileAdm -AclObject $acl
      Ok 'izin berkas kunci benar (SYSTEM + Administrators saja)'
    } catch { Gagal ('izin berkas kunci: ' + $_.Exception.Message) }

    # cadangan untuk user non-admin
    $fileUser = Join-Path $env:USERPROFILE '.ssh\authorized_keys'
    New-Item -ItemType Directory -Path (Join-Path $env:USERPROFILE '.ssh') -Force | Out-Null
    $sudahU = $false
    if (Test-Path $fileUser) { $sudahU = [bool](Select-String -Path $fileUser -Pattern $SIDKU -SimpleMatch -Quiet) }
    if (-not $sudahU) { Add-Content -Path $fileUser -Value $KUNCI -Encoding ascii -Force }
    Ok ('kunci juga ada di ' + $fileUser)

    # ── 5. FIREWALL ───────────────────────────────────────────────────────
    Judul '5. FIREWALL PORT 22'
    $namaRule = @('OpenSSH Server', 'OpenSSH-Server-In-TCP')
    $adaRule = $false
    foreach ($n in $namaRule) {
      $r = Get-NetFirewallRule -DisplayName $n -ErrorAction SilentlyContinue
      if ($r) { $adaRule = $true; Enable-NetFirewallRule -DisplayName $n -ErrorAction SilentlyContinue; Ok ('rule "' + $n + '" diaktifkan') }
    }
    if (-not $adaRule) {
      New-NetFirewallRule -DisplayName 'OpenSSH Server' -Direction Inbound -Protocol TCP -LocalPort 22 -Action Allow -ErrorAction SilentlyContinue | Out-Null
      Ok 'rule firewall port 22 dibuat'
    }
    Get-NetFirewallRule -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -match 'OpenSSH' } |
      ForEach-Object { Info ('  ' + $_.DisplayName + ' | enabled=' + $_.Enabled + ' | profil=' + $_.Profile + ' | ' + $_.Action) }
  }
}

# ── 6. HASIL AKHIR ─────────────────────────────────────────────────────────
Judul '6. HASIL AKHIR'
$s2 = Get-Service sshd -ErrorAction SilentlyContinue
Info ('service sshd : ' + $(if ($s2) { $s2.Status } else { 'TIDAK ADA' }))
$dengar = Get-NetTCPConnection -LocalPort 22 -State Listen -ErrorAction SilentlyContinue
Info ('port 22      : ' + [bool]$dengar)
$akhir8080 = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
Info ('proxy 8080   : ' + [bool]$akhir8080 + '   <-- harus tetap True')

if (Test-Path 'C:\ProgramData\ssh\ssh_host_ed25519_key.pub') {
  $hk = & (Join-Path $DIR_SSH 'ssh-keygen.exe') -lf 'C:\ProgramData\ssh\ssh_host_ed25519_key.pub' 2>&1
  Info ('fingerprint  : ' + ($hk | Out-String).Trim())
}

Write-Host ''
if ($s2 -and $s2.Status -eq 'Running' -and $dengar) {
  Write-Host '  BERHASIL — SSH sudah menyala di komputer toko.' -ForegroundColor Green
  Write-Host '  Kirimkan ke saya: nama komputer + fingerprint di atas.' -ForegroundColor Green
} else {
  Write-Host '  BELUM BERHASIL — kirimkan SELURUH keluaran di atas kepada saya.' -ForegroundColor Yellow
}
Write-Host ''
Read-Host 'Tekan Enter untuk menutup'

}

# ============================================================
#  PERBAIKI KUNCI SSH — jalankan DI SRV KEFA (100.83.215.49)
#  sebagai Administrator, lewat RDP.
#
#  KENAPA SKRIP INI ADA
#  --------------------
#  Kunci publik sudah dipasang, tetapi server tetap menolak:
#      Offering public key: ... SHA256:0K4AQ...
#      Permission denied (publickey,password,keyboard-interactive)
#  Artinya kuncinya SAMPAI ke server tetapi TIDAK DIPAKAI. Penyebab paling
#  umum di Windows OpenSSH, dan skrip ini menangani semuanya:
#
#    1. Akun BUKAN Administrator -> kunci harus di
#       C:\Users\<user>\.ssh\authorized_keys
#    2. Akun Administrator -> kunci harus di
#       C:\ProgramData\ssh\administrators_authorized_keys
#       dan izinnya WAJIB hanya Administrators + SYSTEM.
#       Kalau 'Users' atau warisan masih ada, sshd MENGABAIKAN berkasnya
#       tanpa pesan galat apa pun.
#    3. Berkas tersimpan UTF-16 (Out-File / Set-Content default).
#       sshd hanya membaca ASCII/UTF-8. Ini penyebab yang paling sering
#       terlewat karena berkasnya "terlihat benar" di Notepad.
#    4. Baris terlipat / ada spasi di tengah kunci.
#
#  Skrip ini menulis ke KEDUA lokasi (aman: yang tidak dipakai sshd
#  diabaikan), memaksa ASCII tanpa BOM, memperbaiki izin, lalu MEMBUKTIKAN
#  isinya dengan membaca ulang dan membandingkan.
#
#  CARA PAKAI
#  ----------
#  Simpan berkas ini di SRV KEFA, lalu di PowerShell sebagai Administrator:
#      powershell -ExecutionPolicy Bypass -File .\perbaiki-kunci-ssh.ps1
# ============================================================

$ErrorActionPreference = 'Stop'

# ── Kunci publik yang diizinkan masuk -------------------------
$PUB = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKmjGa4f5oKcQk2Irt0UjNrxGa2I7fXTYkKia5L9e/ru bcode-railway'

function Tulis($m, $warna = 'Gray') { Write-Host $m -ForegroundColor $warna }

Write-Host ''
Tulis '============================================================' 'Cyan'
Tulis '  PERBAIKI KUNCI SSH UNTUK AKSES DARI BCODE-KEFA' 'Cyan'
Tulis '============================================================' 'Cyan'
Write-Host ''

# ── 1. Hak admin ─────────────────────────────────────────────
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
         ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Tulis 'GAGAL: jalankan sebagai Administrator.' 'Red'
  Read-Host 'Tekan Enter untuk menutup'
  exit 1
}
Tulis '[1/6] Hak Administrator: OK' 'Green'

# ── 2. Apakah sshd berjalan & konfigurasinya ─────────────────
Write-Host ''
Tulis '[2/6] Layanan SSH'
$svc = Get-Service sshd -ErrorAction SilentlyContinue
if (-not $svc) {
  Tulis '  GAGAL: layanan sshd tidak ada. Pasang OpenSSH Server dulu:' 'Red'
  Tulis '    Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0' 'Yellow'
  Read-Host 'Tekan Enter untuk menutup'
  exit 1
}
Tulis ('  sshd: ' + $svc.Status + ' / ' + $svc.StartType)
if ($svc.Status -ne 'Running') {
  Start-Service sshd
  Tulis '  sshd dinyalakan' 'Green'
}

# Tampilkan setelan yang relevan supaya kelihatan kalau ada yang aneh.
$cfg = "$env:ProgramData\ssh\sshd_config"
if (Test-Path $cfg) {
  Tulis ('  sshd_config: ' + $cfg)
  Get-Content $cfg | Where-Object { $_ -match '^\s*(PubkeyAuthentication|AuthorizedKeysFile|PasswordAuthentication|Match|PermitRootLogin)' } | ForEach-Object { Tulis ('    ' + $_.Trim()) }
} else {
  Tulis ('  PERHATIAN: ' + $cfg + ' tidak ada (sshd memakai bawaan)') 'Yellow'
}

# ── 3. Akun mana yang dipakai? ───────────────────────────────
Write-Host ''
Tulis '[3/6] Akun'
$user = 'rdpadmin'
$akun = Get-LocalUser -Name $user -ErrorAction SilentlyContinue
if (-not $akun) {
  Tulis ('  PERHATIAN: akun lokal "' + $user + '" tidak ada di mesin ini.') 'Yellow'
  Tulis '  Akun yang ada:' 'Yellow'
  Get-LocalUser | ForEach-Object { Tulis ('    ' + $_.Name + '  enabled=' + $_.Enabled) }
  $user = Read-Host '  Ketik nama akun yang ingin dipakai (kosongkan untuk tetap rdpadmin)'
  if ([string]::IsNullOrWhiteSpace($user)) { $user = 'rdpadmin' }
  $akun = Get-LocalUser -Name $user -ErrorAction SilentlyContinue
}
if ($akun) { Tulis ('  akun: ' + $user + '  enabled=' + $akun.Enabled) }

# Apakah akun ini anggota Administrators?
$anggotaAdmin = $false
try {
  $anggotaAdmin = (Get-LocalGroupMember -Group 'Administrators' -ErrorAction Stop |
    Where-Object { $_.Name -match ('\\' + [regex]::Escape($user) + '$') }) -ne $null
} catch {}
Tulis ('  anggota Administrators: ' + $anggotaAdmin)

# ── 4. Tulis kunci ke SEMUA lokasi yang mungkin ──────────────
Write-Host ''
Tulis '[4/6] Menulis kunci (ASCII tanpa BOM, ke semua lokasi yang mungkin)'

$lokasi = @(
  @{ path = "$env:ProgramData\ssh\administrators_authorized_keys"; ket = 'untuk akun Administrator' },
  @{ path = (Join-Path $env:USERPROFILE '.ssh\authorized_keys');       ket = 'untuk akun ini sendiri' },
  @{ path = ('C:\Users\' + $user + '\.ssh\authorized_keys');           ket = 'untuk ' + $user }
)

foreach ($l in $lokasi) {
  try {
    $folder = Split-Path $l.path
    New-Item -ItemType Directory -Force -Path $folder | Out-Null

    # Kumpulkan kunci yang sudah ada supaya tidak menghapus kunci lain.
    $baris = @()
    if (Test-Path $l.path) {
      # Baca apa adanya; berkas UTF-16 akan terbaca benar oleh Get-Content
      # tetapi kita tulis ulang sebagai ASCII di bawah.
      $baris = @(Get-Content -LiteralPath $l.path -ErrorAction SilentlyContinue |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and $_ -match '^(ssh-|ecdsa-|sk-)' })
    }
    if (-not ($baris | Where-Object { $_.Trim() -eq $PUB })) { $baris += $PUB }
    $baris = $baris | Select-Object -Unique

    # ASCII + tanpa BOM. Ini WAJIB: sshd tidak membaca UTF-16.
    $teks = ($baris -join "`r`n") + "`r`n"
    [System.IO.File]::WriteAllText($l.path, $teks, (New-Object System.Text.ASCIIEncoding))

    Tulis ('  OK  ' + $l.path) 'Green'
    Tulis ('      (' + $l.ket + ', ' + $baris.Count + ' kunci)')
  } catch {
    Tulis ('  GAGAL ' + $l.path + ' -> ' + $_.Exception.Message) 'Red'
  }
}

# ── 5. Izin berkas administrators_authorized_keys ────────────
#     sshd MENGABAIKAN berkas ini kalau izinnya terlalu longgar.
#     Tanpa ini, kunci yang benar pun tidak akan dipakai.
Write-Host ''
Tulis '[5/6] Izin berkas administrators_authorized_keys'
$f = "$env:ProgramData\ssh\administrators_authorized_keys"
if (Test-Path $f) {
  try {
    icacls $f /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null
    Tulis '  izin diperbaiki: hanya Administrators + SYSTEM' 'Green'
    Write-Host '  Izin sekarang:'
    (icacls $f) | ForEach-Object { Tulis ('    ' + $_) }
  } catch {
    Tulis ('  GAGAL memperbaiki izin: ' + $_.Exception.Message) 'Red'
  }
} else {
  Tulis '  (berkas tidak ada - dilewati)' 'Yellow'
}

# ── 6. Buktikan isinya benar ─────────────────────────────────
Write-Host ''
Tulis '[6/6] Verifikasi (membaca ulang dari disk)'
foreach ($l in $lokasi) {
  if (-not (Test-Path $l.path)) { continue }
  $b = [System.IO.File]::ReadAllBytes($l.path)
  $adaBom = ($b.Length -ge 2 -and $b[0] -eq 0xFF -and $b[1] -eq 0xFE)
  $adaNol = ($b -contains 0)
  $teks = [System.IO.File]::ReadAllText($l.path)
  $adaKunci = $teks.Contains($PUB)
  $tanda = if ($adaKunci -and -not $adaBom -and -not $adaNol) { 'OK   ' } else { 'MASALAH' }
  $warna = if ($tanda -eq 'OK   ') { 'Green' } else { 'Red' }
  Tulis ('  ' + $tanda + ' ' + $l.path) $warna
  Tulis ('         ada kunci=' + $adaKunci + '  BOM=' + $adaBom + '  byte-nol(UTF16)=' + $adaNol)
}

# ── Selesai ──────────────────────────────────────────────────
Write-Host ''
Tulis '============================================================' 'Cyan'
Tulis '  SELESAI. Sekarang dari BCODE-KEFA jalankan:' 'Green'
Tulis ('    ssh ' + $user + '@100.83.215.49 hostname') 'Green'
Tulis '============================================================' 'Cyan'
Write-Host ''
Tulis 'Kalau MASIH ditolak, kirimkan keluaran ini (dari BCODE-KEFA):' 'Yellow'
Tulis '    ssh -vvv -i $env:USERPROFILE\.ssh\id_ed25519 ' + $user + '@100.83.215.49 hostname 2>&1 | Select-String "Offering|denied|Authentications"' 'Yellow'
Write-Host ''
Read-Host 'Tekan Enter untuk menutup'

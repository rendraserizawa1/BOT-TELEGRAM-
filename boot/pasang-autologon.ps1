# ============================================================
#  PASANG AUTOLOGON — supaya agen iPos menyala tanpa perlu ada
#  yang login setelah PC crash/reboot.
#
#  LATAR (insiden 20/11/2026)
#  --------------------------
#  PC BCODE-KEFA crash 5x dalam sehari. Setelah reboot, PC berhenti di
#  layar login dan agen pengirim data TIDAK menyala sampai ada manusia
#  masuk RDP. Selama jeda itu ketiga toko (CP, NK, KEFA) tampak "mati
#  serentak" padahal ketiga API iPos sehat.
#
#  JANGAN jalankan agen sebagai SYSTEM atau lewat BootTrigger.
#  Nota ditulis ke UNC \\100.125.99.99\E\... dan kredensial SMB-nya
#  tersimpan PER USER (cmdkey: Domain:target=100.125.99.99, User=ADMIN_DIMAS).
#  Akun SYSTEM tidak bisa memakai kredensial itu -> penulisan nota rusak.
#  Karena itu autologon HARUS sebagai rdpadmin.
#
#  CARA PAKAI
#  ----------
#  Klik kanan berkas ini -> "Run with PowerShell" sebagai Administrator,
#  atau dari PowerShell yang sudah elevated:
#      powershell -ExecutionPolicy Bypass -File C:\BOT-TELEGRAM-\boot\pasang-autologon.ps1
#
#  Password diketik tersembunyi dan TIDAK PERNAH ditampilkan atau ditulis
#  ke log. Windows menyimpannya di registry Winlogon (perilaku bawaan
#  autologon) — itu memang cara kerjanya, dan risikonya dijelaskan di akhir.
#
#  Untuk membatalkan: jalankan boot\lepas-autologon.ps1
# ============================================================

$ErrorActionPreference = 'Stop'
$Winlogon = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
$User     = 'rdpadmin'
$Domain   = $env:COMPUTERNAME

function Tulis($m, $warna = 'Gray') { Write-Host $m -ForegroundColor $warna }

Write-Host ''
Tulis '============================================================' 'Cyan'
Tulis '  PASANG AUTOLOGON UNTUK rdpadmin' 'Cyan'
Tulis '============================================================' 'Cyan'
Write-Host ''

# ── 1. Harus Administrator ──────────────────────────────────
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
         ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Tulis 'GAGAL: skrip ini harus dijalankan sebagai Administrator.' 'Red'
  Tulis 'Klik kanan -> Run with PowerShell (sebagai Administrator), lalu ulangi.' 'Yellow'
  Write-Host ''
  Read-Host 'Tekan Enter untuk menutup'
  exit 1
}
Tulis '[1/5] Hak Administrator: OK' 'Green'

# ── 2. Pastikan akunnya ada dan aktif ───────────────────────
try {
  $akun = Get-LocalUser -Name $User -ErrorAction Stop
} catch {
  Tulis ('GAGAL: akun ' + $User + ' tidak ditemukan.') 'Red'
  Read-Host 'Tekan Enter untuk menutup'
  exit 1
}
if (-not $akun.Enabled) {
  Tulis ('GAGAL: akun ' + $User + ' sedang dinonaktifkan.') 'Red'
  Read-Host 'Tekan Enter untuk menutup'
  exit 1
}
Tulis ('[2/5] Akun ' + $User + ' aktif: OK') 'Green'

# ── 3. Minta password (tersembunyi) dan VERIFIKASI dulu ─────
#     Verifikasi ini WAJIB. Kalau password salah tersimpan, PC akan
#     gagal login otomatis setiap kali boot dan malah menambah masalah.
Tulis '[3/5] Masukkan password ' + $User + ' (tidak akan terlihat di layar):'
$secure = Read-Host -AsSecureString 'Password'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if ([string]::IsNullOrEmpty($plain)) {
  Tulis 'GAGAL: password kosong.' 'Red'
  Read-Host 'Tekan Enter untuk menutup'
  exit 1
}

Tulis '      Memverifikasi password ke Windows...'
$sah = $false
try {
  Add-Type -AssemblyName System.DirectoryServices.AccountManagement
  $ctx = New-Object System.DirectoryServices.AccountManagement.PrincipalContext('Machine', $Domain)
  $sah = $ctx.ValidateCredentials($User, $plain)
} catch {
  Tulis ('      Tidak bisa memverifikasi otomatis: ' + $_.Exception.Message) 'Yellow'
  Tulis '      Lanjutkan HANYA kalau Anda yakin passwordnya benar.' 'Yellow'
  $jawab = Read-Host '      Lanjutkan? (ketik YA)'
  $sah = ($jawab -eq 'YA')
}

if (-not $sah) {
  Tulis 'GAGAL: password DITOLAK Windows. Tidak ada yang diubah.' 'Red'
  $plain = $null
  Read-Host 'Tekan Enter untuk menutup'
  exit 1
}
Tulis '      Password benar: OK' 'Green'

# ── 4. Simpan setelan autologon ─────────────────────────────
#     AutoAdminLogon  : '1' = aktif
#     DefaultUserName : akun yang dipakai
#     DefaultDomainName: nama komputer (akun lokal)
#     DefaultPassword : password (plaintext — begitulah cara Windows)
#     AutoLogonCount TIDAK di-set: kalau di-set, autologon berhenti setelah
#     N kali. Kita butuh SELAMANYA.
try {
  New-ItemProperty -Path $Winlogon -Name 'AutoAdminLogon'   -Value '1'      -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $Winlogon -Name 'DefaultUserName'  -Value $User    -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $Winlogon -Name 'DefaultDomainName'-Value $Domain  -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $Winlogon -Name 'DefaultPassword'  -Value $plain   -PropertyType String -Force | Out-Null
  # Hapus AutoLogonCount kalau ada sisa percobaan sebelumnya.
  Remove-ItemProperty -Path $Winlogon -Name 'AutoLogonCount' -ErrorAction SilentlyContinue
  Tulis '[4/5] Setelan autologon disimpan: OK' 'Green'
} catch {
  Tulis ('GAGAL menyimpan: ' + $_.Exception.Message) 'Red'
  $plain = $null
  Read-Host 'Tekan Enter untuk menutup'
  exit 1
} finally {
  # Jangan biarkan password tertinggal di variabel selama proses hidup.
  $plain = $null
}

# ── 5. Verifikasi hasil (tanpa mencetak password) ───────────
$v = Get-ItemProperty -Path $Winlogon
Tulis '[5/5] Verifikasi:' 'Green'
Tulis ('      AutoAdminLogon    = ' + $v.AutoAdminLogon)
Tulis ('      DefaultUserName   = ' + $v.DefaultUserName)
Tulis ('      DefaultDomainName = ' + $v.DefaultDomainName)
$adaPass = -not [string]::IsNullOrEmpty($v.DefaultPassword)
Tulis ('      DefaultPassword   = ' + $(if ($adaPass) { 'TERSIMPAN (' + $v.DefaultPassword.Length + ' karakter)' } else { 'TIDAK ADA' }))

Write-Host ''
Tulis '============================================================' 'Cyan'
if ($v.AutoAdminLogon -eq '1' -and $v.DefaultUserName -eq $User -and $adaPass) {
  Tulis '  BERHASIL. Mulai reboot berikutnya, PC akan login sendiri' 'Green'
  Tulis '  sebagai ' + $User + ' dan agen iPos menyala tanpa campur tangan.' 'Green'
} else {
  Tulis '  PERIKSA LAGI: hasil verifikasi tidak sesuai harapan.' 'Red'
}
Tulis '============================================================' 'Cyan'
Write-Host ''
Tulis 'PENTING — RISIKO YANG HARUS ANDA TAHU:' 'Yellow'
Tulis '  1. Password tersimpan PLAINTEXT di registry. Siapa pun yang bisa' 'Yellow'
Tulis '     membaca registry sebagai admin bisa membacanya. Ini cara kerja' 'Yellow'
Tulis '     autologon Windows, bukan pilihan skrip ini.' 'Yellow'
Tulis '  2. PC akan masuk sendiri ke desktop setelah menyala. Kalau PC ini' 'Yellow'
Tulis '     ada di ruangan yang bisa diakses orang lain, pertimbangkan ulang.' 'Yellow'
Tulis '  3. Autologon TIDAK mencegah crash. Ini hanya mempercepat pemulihan.' 'Yellow'
Tulis '     Penyebab crash (tidak ada UPS, RAM 3,8 GB terpakai 92%) tetap' 'Yellow'
Tulis '     harus ditangani.' 'Yellow'
Write-Host ''
Tulis 'Untuk membatalkan: boot\lepas-autologon.ps1' 'Cyan'
Write-Host ''
Read-Host 'Tekan Enter untuk menutup'

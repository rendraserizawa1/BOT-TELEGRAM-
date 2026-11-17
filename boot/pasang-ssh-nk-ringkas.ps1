# ============================================================
#  TEMPEL-LANGSUNG: pasang SSH di komputer toko NK
#  Buka PowerShell sebagai Administrator, tempel semua, Enter.
# ============================================================
$K = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKmjGa4f5oKcQk2Irt0UjNrxGa2I7fXTYkKia5L9e/ru bcode-railway'

Write-Host ('Mesin: ' + $env:COMPUTERNAME + ' | User: ' + $env:USERNAME) -ForegroundColor Cyan
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'BUKAN Administrator. Tutup, klik kanan PowerShell > Run as administrator.' -ForegroundColor Red
  return
}

# 1) Pasang OpenSSH Server (lewati kalau sudah ada)
if (-not (Test-Path 'C:\Windows\System32\OpenSSH\sshd.exe')) {
  Write-Host 'Memasang OpenSSH Server...' -ForegroundColor Yellow
  Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.0.0' | Out-Null
}

# 2) Nyalakan + otomatis saat boot
Set-Service sshd -StartupType Automatic
Start-Service sshd

# 3) Pasang kunci publik (WAJIB di administrators_authorized_keys
#    karena user Administrator -> Windows mengabaikan ~/.ssh/authorized_keys)
$F = 'C:\ProgramData\ssh\administrators_authorized_keys'
New-Item -ItemType Directory -Path 'C:\ProgramData\ssh' -Force | Out-Null
if (-not (Test-Path $F) -or -not (Select-String -Path $F -Pattern 'IKmjGa4f5oKcQk2Irt0UjNrxGa2I7fXTYkKia5L9e/ru' -SimpleMatch -Quiet)) {
  Add-Content -Path $F -Value $K -Encoding ascii
}
$acl = New-Object Security.AccessControl.FileSecurity
$acl.SetAccessRuleProtection($true, $false)
$acl.SetOwner([Security.Principal.NTAccount]'BUILTIN\Administrators')
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('NT AUTHORITY\SYSTEM','FullControl','Allow')))
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('BUILTIN\Administrators','FullControl','Allow')))
Set-Acl -Path $F -AclObject $acl

# 4) Firewall
if (Get-NetFirewallRule -DisplayName 'OpenSSH Server' -ErrorAction SilentlyContinue) {
  Enable-NetFirewallRule -DisplayName 'OpenSSH Server'
} else {
  New-NetFirewallRule -DisplayName 'OpenSSH Server' -Direction Inbound -Protocol TCP -LocalPort 22 -Action Allow | Out-Null
}

# 5) Verifikasi
Write-Host ''
Write-Host '--- HASIL ---' -ForegroundColor Cyan
Write-Host ('sshd        : ' + (Get-Service sshd).Status)
Write-Host ('port 22     : ' + [bool](Get-NetTCPConnection -LocalPort 22 -State Listen -ErrorAction SilentlyContinue))
Write-Host ('proxy 8080  : ' + [bool](Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) + ' (harus tetap True)')
Write-Host ('komputer    : ' + $env:COMPUTERNAME)
Write-Host ('kunci terpasang: ' + (Test-Path $F))
Write-Host ''
Write-Host 'Kirim ke saya: nama komputer + hasil di atas.' -ForegroundColor Yellow

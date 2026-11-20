# ============================================================
#  LEPAS AUTOLOGON — mengembalikan PC ke kondisi semula
#  (berhenti di layar login, harus login manual).
#
#  Jalankan sebagai Administrator:
#      powershell -ExecutionPolicy Bypass -File C:\BOT-TELEGRAM-\boot\lepas-autologon.ps1
#
#  Tidak menyentuh apa pun selain 4 nilai registry Winlogon yang
#  dipasang oleh pasang-autologon.ps1.
# ============================================================

$ErrorActionPreference = 'Stop'
$Winlogon = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
         ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Write-Host 'GAGAL: harus dijalankan sebagai Administrator.' -ForegroundColor Red
  Read-Host 'Tekan Enter untuk menutup'
  exit 1
}

Write-Host ''
Write-Host 'Melepas autologon...' -ForegroundColor Cyan

# AutoAdminLogon = '0' adalah cara resmi mematikan autologon.
# DefaultPassword dihapus supaya password tidak tertinggal di registry.
Set-ItemProperty -Path $Winlogon -Name 'AutoAdminLogon' -Value '0' -Force
Remove-ItemProperty -Path $Winlogon -Name 'DefaultPassword' -ErrorAction SilentlyContinue
Remove-ItemProperty -Path $Winlogon -Name 'AutoLogonCount'  -ErrorAction SilentlyContinue

$v = Get-ItemProperty -Path $Winlogon
Write-Host ''
Write-Host 'Hasil:' -ForegroundColor Green
Write-Host ('  AutoAdminLogon  = ' + $v.AutoAdminLogon)
Write-Host ('  DefaultPassword = ' + $(if ([string]::IsNullOrEmpty($v.DefaultPassword)) { 'SUDAH DIHAPUS' } else { 'MASIH ADA - periksa manual' }))
Write-Host ''
Write-Host 'PC akan berhenti di layar login lagi setelah reboot.' -ForegroundColor Yellow
Write-Host 'Ingat: berarti agen iPos TIDAK akan menyala sendiri setelah crash.' -ForegroundColor Yellow
Write-Host ''
Read-Host 'Tekan Enter untuk menutup'

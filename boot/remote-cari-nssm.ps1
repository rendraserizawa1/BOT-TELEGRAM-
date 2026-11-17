$ErrorActionPreference = 'Continue'

Write-Output '=== SERVICE NSSM: nama, folder, dan parameter ==='
Get-CimInstance Win32_Service | Where-Object { $_.PathName -match 'nssm' } | ForEach-Object {
  Write-Output ('Name      : ' + $_.Name)
  Write-Output ('State     : ' + $_.State)
  Write-Output ('StartName : ' + $_.StartName)
  Write-Output ('PathName  : ' + $_.PathName)
  Write-Output ''
}

Write-Output '=== DAFTAR SERVICE (cari yang mirip ipos/proxy) ==='
Get-Service | Where-Object { $_.Name -match 'ipos|proxy|bcode|kefa|api' } | ForEach-Object {
  Write-Output ('  ' + $_.Name + '  status=' + $_.Status)
}

Write-Output ''
Write-Output '=== CARI server.js DI SELURUH DISK (C:) ==='
$hasil = Get-ChildItem C:\ -Filter 'server.js' -Recurse -File -ErrorAction SilentlyContinue -Force |
  Where-Object { $_.FullName -notmatch 'node_modules|\\Windows\\|MeshCentral|npm-cache' }
if ($hasil) {
  $hasil | Select-Object -First 20 | ForEach-Object {
    Write-Output ('  ' + $_.FullName + '  (' + $_.Length + ' byte, ' + $_.LastWriteTime + ')')
  }
} else { Write-Output '  tidak ditemukan' }

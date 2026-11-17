$ErrorActionPreference = 'Continue'
Write-Output '=== COMMAND LINE PID 4700 ==='
$p = Get-CimInstance Win32_Process -Filter 'ProcessId=4700'
if ($p) { Write-Output $p.CommandLine } else { Write-Output '(PID 4700 tidak ada)' }

Write-Output ''
Write-Output '=== SERVICE PEMBUNGKUS ==='
$s = Get-CimInstance Win32_Service | Where-Object { $_.ProcessId -eq 4700 }
if ($s) {
  foreach ($x in $s) {
    Write-Output ('Name      : ' + $x.Name)
    Write-Output ('StartName : ' + $x.StartName)
    Write-Output ('PathName  : ' + $x.PathName)
  }
} else { Write-Output '(tidak ada service dengan PID 4700 - mungkin proses anak)' }

Write-Output ''
Write-Output '=== PROSES INDUK ==='
if ($p) { Write-Output ('ParentProcessId = ' + $p.ParentProcessId) }

Write-Output ''
Write-Output '=== SEMUA node.exe: PID + command line (dipotong 160) ==='
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
  $cl = ''
  if ($_.CommandLine) { $cl = $_.CommandLine }
  if ($cl.Length -gt 160) { $cl = $cl.Substring(0, 160) }
  Write-Output ('  PID ' + $_.ProcessId + ' | ' + $cl)
}

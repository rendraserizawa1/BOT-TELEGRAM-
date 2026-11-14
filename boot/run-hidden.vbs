' Jalankan PowerShell tersembunyi untuk fallback autostart login.
' Dipakai HKCU Run: PM2 dan iPosAPI.
Set sh = CreateObject("WScript.Shell")
If WScript.Arguments.Count = 0 Then WScript.Quit 1
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & WScript.Arguments(0) & """"
sh.Run cmd, 0, False

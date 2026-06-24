' Launch test-point-web without any console window
Set WshShell = CreateObject("WScript.Shell")
projectDir = WshShell.CurrentDirectory
cmd = "powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & projectDir & "\scripts\launcher.ps1"" -ProjectDir """ & projectDir & """"
WshShell.Run cmd, 0, False

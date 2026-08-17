Set WshShell = CreateObject("WScript.Shell")
Set Fso = CreateObject("Scripting.FileSystemObject")

scriptDir = Fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = Fso.GetParentFolderName(scriptDir)
cmd = "powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & projectDir & "\scripts\launcher.ps1"" -ProjectDir """ & projectDir & """"
WshShell.Run cmd, 0, False

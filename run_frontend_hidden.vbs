Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
CurrentDir = FSO.GetParentFolderName(WScript.ScriptFullName)

WshShell.CurrentDirectory = CurrentDir & "\frontend"
WshShell.Run "cmd /c call npm run dev -- --host 0.0.0.0 > ..\frontend_app.log 2>&1", 0, False

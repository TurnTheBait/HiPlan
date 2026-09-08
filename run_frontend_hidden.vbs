Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
CurrentDir = FSO.GetParentFolderName(WScript.ScriptFullName)

If Not FSO.FolderExists(CurrentDir & "\logs") Then
    FSO.CreateFolder(CurrentDir & "\logs")
End If

WshShell.CurrentDirectory = CurrentDir & "\frontend"
WshShell.Run "cmd.exe /d /c ""npm run dev -- --host 0.0.0.0 --port 5173 > ..\logs\frontend_app.log 2>&1""", 0, False

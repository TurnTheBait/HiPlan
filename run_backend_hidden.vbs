Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
CurrentDir = FSO.GetParentFolderName(WScript.ScriptFullName)

If Not FSO.FolderExists(CurrentDir & "\logs") Then
    FSO.CreateFolder(CurrentDir & "\logs")
End If

WshShell.CurrentDirectory = CurrentDir & "\backend"
WshShell.Run "cmd /c ""venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level error > ..\logs\backend_app.log 2>&1""", 0, False

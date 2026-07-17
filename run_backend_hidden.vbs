Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
CurrentDir = FSO.GetParentFolderName(WScript.ScriptFullName)

WshShell.CurrentDirectory = CurrentDir & "\backend"
WshShell.Run "cmd /c call venv\Scripts\activate.bat && uvicorn app.main:app --host 0.0.0.0 --port 8000 > ..\backend_app.log 2>&1", 0, False

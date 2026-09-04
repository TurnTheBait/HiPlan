@echo off
rem Launcher principale per l'aggiornamento Windows di HiPlan
call "%~dp0scripts\update_windows.bat" %*
exit /b %ERRORLEVEL%

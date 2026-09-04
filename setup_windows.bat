@echo off
rem Launcher principale per la configurazione Windows di HiPlan
call "%~dp0scripts\setup_windows.bat" %*
exit /b %ERRORLEVEL%

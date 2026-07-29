@echo off
setlocal EnableExtensions
title HiPlan - Arresto Servizi
echo ========================================================
echo          ARRESTO DEL SERVIZIO HIPLAN SU WINDOWS
echo ========================================================
echo.

set "NO_PAUSE=0"
if /I "%~1"=="--no-pause" set "NO_PAUSE=1"

echo [1/2] Ricerca e chiusura processi sulla porta 8000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a > nul 2>&1
)

echo [2/2] Ricerca e chiusura processi sulla porta 5173...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173 ^| findstr LISTENING') do (
    taskkill /F /PID %%a > nul 2>&1
)

echo.
echo ========================================================
echo   SERVIZI HIPLAN ARRESTATI
echo ========================================================
if "%NO_PAUSE%"=="0" (
    echo.
    timeout /t 5 /nobreak >nul
)
exit /b 0

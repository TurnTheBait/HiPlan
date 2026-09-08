@echo off
setlocal EnableExtensions EnableDelayedExpansion
title HiPlan - Arresto Servizi
cd /d "%~dp0"
chcp 65001 >nul

rem Configurazione colori ANSI (Windows 10/11 / Windows Terminal)
for /F %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"
if defined ESC (
    set "C_RESET=!ESC![0m"
    set "C_BOLD=!ESC![1m"
    set "C_DIM=!ESC![2m"
    set "C_RED=!ESC![91m"
    set "C_GREEN=!ESC![92m"
    set "C_YELLOW=!ESC![93m"
    set "C_BLUE=!ESC![94m"
    set "C_CYAN=!ESC![96m"
    set "C_WHITE=!ESC![97m"
    set "C_GRAY=!ESC![90m"
) else (
    set "C_RESET="
    set "C_BOLD="
    set "C_DIM="
    set "C_RED="
    set "C_GREEN="
    set "C_YELLOW="
    set "C_BLUE="
    set "C_CYAN="
    set "C_WHITE="
    set "C_GRAY="
)

set "CURRENT_PCT=0"
set "NO_PAUSE=0"
if /I "%~1"=="--no-pause" set "NO_PAUSE=1"

echo.
echo !C_BLUE!╭──────────────────────────────────────────────────────────────────╮!C_RESET!
echo !C_BLUE!│!C_RESET!  !C_BOLD!!C_WHITE!■  H I P L A N  ·  A R R E S T O  S E R V I Z I                 !C_RESET!!C_BLUE!│!C_RESET!
echo !C_BLUE!│!C_RESET!     !C_GRAY!Chiusura Servizi e Processi Attivi                           !C_RESET!!C_BLUE!│!C_RESET!
echo !C_BLUE!╰──────────────────────────────────────────────────────────────────╯!C_RESET!
echo.

call :advance_bar 30 "Ricerca processi porta 8000..."

rem Metodo primario: PowerShell (funziona su qualsiasi lingua Windows)
powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue; if ($p) { $p | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; exit 0 } else { exit 1 }" >nul 2>&1

rem Fallback netstat: sia inglese (LISTENING) che italiano (IN ASCOLTO)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr /I "LISTENING"') do (
    taskkill /F /T /PID %%a >nul 2>&1
)
for /f "tokens=6" %%a in ('netstat -aon ^| findstr :8000 ^| findstr /I "ASCOLTO"') do (
    taskkill /F /T /PID %%a >nul 2>&1
)

call :advance_bar 55 "Backend API arrestato"

call :advance_bar 70 "Ricerca processi porta 5173..."

rem Metodo primario: PowerShell
powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue; if ($p) { $p | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; exit 0 } else { exit 1 }" >nul 2>&1

rem Fallback netstat: inglese e italiano
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173 ^| findstr /I "LISTENING"') do (
    taskkill /F /T /PID %%a >nul 2>&1
)
for /f "tokens=6" %%a in ('netstat -aon ^| findstr :5173 ^| findstr /I "ASCOLTO"') do (
    taskkill /F /T /PID %%a >nul 2>&1
)

call :advance_bar 85 "Frontend Web arrestato"

rem Chiusura processi residui (uvicorn, vite, app.main)
powershell -NoProfile -Command "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*app.main:app*' -or $_.CommandLine -like '*vite*--port 5173*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
taskkill /F /IM uvicorn.exe >nul 2>&1

call :advance_bar 100 "Chiusura completata"
call :finish_bar "Servizi HiPlan arrestati con successo"

echo !C_GREEN!╭──────────────────────────────────────────────────────────────────╮!C_RESET!
echo !C_GREEN!│!C_RESET!  !C_BOLD!!C_WHITE!✔  SERVIZI HIPLAN ARRESTATI CON SUCCESSO                        !C_RESET!!C_GREEN!│!C_RESET!
echo !C_GREEN!╰──────────────────────────────────────────────────────────────────╯!C_RESET!
echo.

if "%NO_PAUSE%"=="0" (
    echo !C_DIM!Finestra in chiusura automatica tra 3 secondi...!C_RESET!
    timeout /t 3 /nobreak >nul
)
exit /b 0

rem ------------------------------------------------------------------
rem Subroutine: Disegna la barra su singola riga in tempo reale
rem ------------------------------------------------------------------
:draw_bar
setlocal EnableDelayedExpansion
set "PCT=%~1"
set "TEXT=%~2"
set /a "NUM_F=PCT * 18 / 100"
set /a "NUM_E=18 - NUM_F"
set "BAR_F="
set "BAR_E="
for /L %%x in (1,1,!NUM_F!) do set "BAR_F=!BAR_F!█"
for /L %%x in (1,1,!NUM_E!) do set "BAR_E=!BAR_E!░"

set "SP= "
if !PCT! LSS 100 set "SP=  "
if !PCT! LSS 10 set "SP=   "

if defined ESC (
    <nul set /p "=!ESC![2K!ESC![1G  !C_GRAY![!C_CYAN!!BAR_F!!C_GRAY!!BAR_E!]!C_RESET! !C_BOLD!!C_WHITE!!PCT!%%!C_RESET!!SP!!C_WHITE!!TEXT!!C_RESET!"
) else (
    <nul set /p "=  [!BAR_F!!BAR_E!] !PCT!%% !TEXT!^r"
)
endlocal
exit /b 0

:advance_bar
setlocal EnableDelayedExpansion
set "TARGET=%~1"
set "TEXT=%~2"
set "CURR=!CURRENT_PCT!"
:advance_loop
if !CURR! LSS !TARGET! (
    set /a "CURR+=3"
    if !CURR! GTR !TARGET! set "CURR=!TARGET!"
    call :draw_bar !CURR! "!TEXT!"
    powershell -NoProfile -Command "Start-Sleep -Milliseconds 10" >nul 2>&1
    goto advance_loop
)
endlocal & set "CURRENT_PCT=%TARGET%"
exit /b 0

:finish_bar
setlocal EnableDelayedExpansion
set "TEXT=%~1"
set "BAR_F="
for /L %%x in (1,1,18) do set "BAR_F=!BAR_F!█"
if defined ESC (
    echo !ESC![2K!ESC![1G  !C_GRAY![!C_GREEN!!BAR_F!!C_GRAY!]!C_RESET! !C_BOLD!!C_GREEN!100%%!C_RESET!  !C_BOLD!!C_GREEN!✔ !TEXT!!C_RESET!
) else (
    echo.
    echo   [!BAR_F!] 100%%  ✔ !TEXT!
)
echo.
endlocal
exit /b 0

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

echo.
echo !C_BLUE!╔══════════════════════════════════════════════════════════════════╗!C_RESET!
echo !C_BLUE!║!C_BOLD!!C_WHITE!                  H I P L A N  -  A R R E S T O                   !C_RESET!!C_BLUE!║!C_RESET!
echo !C_BLUE!║!C_GRAY!                Chiusura Servizi e Processi Attivi                !C_RESET!!C_BLUE!║!C_RESET!
echo !C_BLUE!╚══════════════════════════════════════════════════════════════════╝!C_RESET!
echo.

set "NO_PAUSE=0"
if /I "%~1"=="--no-pause" set "NO_PAUSE=1"

set "TERMINATED_8000=0"
echo !C_CYAN![1/2]!C_RESET! Ricerca processi su porta 8000 (Backend API)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a > nul 2>&1
    if not errorlevel 1 (
        echo       !C_GREEN![✔]!C_RESET! Processo PID %%a terminato.
        set "TERMINATED_8000=1"
    )
)
if "!TERMINATED_8000!"=="0" (
    echo       !C_GRAY![•] Nessun processo attivo trovato sulla porta 8000.!C_RESET!
)

set "TERMINATED_5173=0"
echo !C_CYAN![2/2]!C_RESET! Ricerca processi su porta 5173 (Frontend Web)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173 ^| findstr LISTENING') do (
    taskkill /F /PID %%a > nul 2>&1
    if not errorlevel 1 (
        echo       !C_GREEN![✔]!C_RESET! Processo PID %%a terminato.
        set "TERMINATED_5173=1"
    )
)
if "!TERMINATED_5173!"=="0" (
    echo       !C_GRAY![•] Nessun processo attivo trovato sulla porta 5173.!C_RESET!
)

echo.
echo !C_GREEN!╔══════════════════════════════════════════════════════════════════╗!C_RESET!
echo !C_GREEN!║!C_BOLD!!C_WHITE!              SERVIZI HIPLAN ARRESTATI CON SUCCESSO               !C_RESET!!C_GREEN!║!C_RESET!
echo !C_GREEN!╚══════════════════════════════════════════════════════════════════╝!C_RESET!
echo.
echo   Tutti i processi associati a HiPlan sono stati chiusi correttamente.
echo.

if "%NO_PAUSE%"=="0" (
    echo !C_DIM!Finestra in chiusura automatica tra 3 secondi...!C_RESET!
    timeout /t 3 /nobreak >nul
)
exit /b 0

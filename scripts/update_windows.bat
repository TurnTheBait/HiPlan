@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."
chcp 65001 >nul
title HiPlan - Aggiornamento

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

rem Barre di avanzamento testuali
set "BAR_33=[██████████░░░░░░░░░░░░░░░░░░░░]  33%%"
set "BAR_66=[████████████████████░░░░░░░░░░]  66%%"
set "BAR_100=[██████████████████████████████] 100%%"

if not exist "logs" mkdir "logs"
set "UPDATE_LOG=%~dp0..\logs\update.log"
set "TEMP_LOG=%~dp0..\logs\update_temp.log"
if exist "%TEMP_LOG%" del /f /q "%TEMP_LOG%" >nul 2>&1

echo.
echo !C_CYAN!╔══════════════════════════════════════════════════════════════════╗!C_RESET!
echo !C_CYAN!║!C_BOLD!!C_WHITE!            H I P L A N  -  A G G I O R N A M E N T O             !C_RESET!!C_CYAN!║!C_RESET!
echo !C_CYAN!║!C_GRAY!               Procedura di Aggiornamento Versione                !C_RESET!!C_CYAN!║!C_RESET!
echo !C_CYAN!╚══════════════════════════════════════════════════════════════════╝!C_RESET!
echo.

echo !C_BOLD!─── [ 1/3 ] Arresto Servizi Attivi ─────────────────────────────────!C_RESET!
echo        !C_CYAN!!BAR_33!!C_RESET!  !C_GRAY!Chiusura processi sulle porte 8000 e 5173...!C_RESET!
call stop_windows.bat --no-pause
echo        !C_GREEN![✔] Servizi arrestati.!C_RESET!

echo.
echo !C_BOLD!─── [ 2/3 ] Esecuzione Backup di Sicurezza Database ────────────────!C_RESET!
echo        !C_CYAN!!BAR_66!!C_RESET!  !C_GRAY!Creazione copia di backup del database SQLite...!C_RESET!
if exist "backend\venv\Scripts\python.exe" (
    "backend\venv\Scripts\python.exe" -c "import sys; sys.path.append('backend'); from app.services.backup_service import run_backup; run_backup()" > "%TEMP_LOG%" 2>&1
    if errorlevel 1 (
        echo        !C_YELLOW![!] Attenzione: Backup automatico non riuscito, procedo comunque.!C_RESET!
        if exist "%TEMP_LOG%" (
            powershell -NoProfile -Command "Get-Content '%TEMP_LOG%' -Tail 5 | ForEach-Object { '          ' + $_ }"
        )
    ) else (
        echo        !C_GREEN![✔] Backup di sicurezza completato con successo.!C_RESET!
    )
) else (
    echo        !C_GRAY![•] Ambiente Python non ancora configurato, salto il backup preventivo.!C_RESET!
)

echo.
echo !C_BOLD!─── [ 3/3 ] Aggiornamento Dipendenze e Ricompilazione ──────────────!C_RESET!
echo        !C_CYAN!!BAR_100!!C_RESET!  !C_GRAY!Esecuzione setup dipendenze e build frontend...!C_RESET!
call scripts\setup_windows.bat --no-pause
if errorlevel 1 (
    set "FAILED_STEP=Aggiornamento Dipendenze e Build"
    set "FAILED_CMD=scripts\setup_windows.bat --no-pause"
    goto step_error
)

echo.
echo !C_GREEN!╔══════════════════════════════════════════════════════════════════╗!C_RESET!
echo !C_GREEN!║!C_BOLD!!C_WHITE!              AGGIORNAMENTO COMPLETATO CON SUCCESSO               !C_RESET!!C_GREEN!║!C_RESET!
echo !C_GREEN!╚══════════════════════════════════════════════════════════════════╝!C_RESET!
echo.
echo !C_BOLD!  Stato dell'installazione:!C_RESET!
echo     !C_GREEN!✔!C_RESET!  Tutti i file applicativi sono stati aggiornati.
echo     !C_GREEN!✔!C_RESET!  Database, allegati e configurazioni .env sono preservati e intatti.
echo.
echo !C_BOLD!  Prossimi passi:!C_RESET!
echo     !C_GREEN!➜!C_RESET!  Riavvia subito HiPlan eseguendo:
echo        !C_CYAN!!C_BOLD!start_windows.bat!C_RESET!
echo.
pause
exit /b 0

:step_error
echo.
echo !C_RED!╔══════════════════════════════════════════════════════════════════╗!C_RESET!
echo !C_RED!║!C_BOLD!!C_WHITE!                   ERRORE DURANTE L'ESECUZIONE                    !C_RESET!!C_RED!║!C_RESET!
echo !C_RED!╚══════════════════════════════════════════════════════════════════╝!C_RESET!
echo.
echo   !C_BOLD!Fase fallita:!C_RESET! !C_YELLOW!!FAILED_STEP!!C_RESET!
echo   !C_BOLD!Comando:!C_RESET!      !C_GRAY!!FAILED_CMD!!C_RESET!
echo.
echo   !C_BOLD!Consulta logs\setup.log per maggiori informazioni.!C_RESET!
echo.
pause
exit /b 1

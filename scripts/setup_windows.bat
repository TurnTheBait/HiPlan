@echo off
setlocal EnableExtensions EnableDelayedExpansion
title HiPlan - Configurazione Windows
cd /d "%~dp0.."
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

rem Barre di avanzamento testuali
set "BAR_0=[░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]   0%%"
set "BAR_33=[██████████░░░░░░░░░░░░░░░░░░░░]  33%%"
set "BAR_66=[████████████████████░░░░░░░░░░]  66%%"
set "BAR_100=[██████████████████████████████] 100%%"

rem Evita che una variabile DEBUG globale sovrascriva backend\.env.
set "DEBUG="

set "NO_PAUSE=0"
set "RUN_SEED=0"

if not exist "logs" mkdir "logs"
set "SETUP_LOG=%~dp0..\logs\setup.log"
set "TEMP_LOG=%~dp0..\logs\setup_temp.log"
if exist "%TEMP_LOG%" del /f /q "%TEMP_LOG%" >nul 2>&1

:parse_args
if "%~1"=="" goto args_done
if /I "%~1"=="--no-pause" (
    set "NO_PAUSE=1"
) else if /I "%~1"=="--seed" (
    set "RUN_SEED=1"
) else (
    echo.
    echo !C_RED![✖] ERRORE: Opzione non riconosciuta: %~1!C_RESET!
    echo !C_GRAY!Uso: setup_windows.bat [--seed] [--no-pause]!C_RESET!
    exit /b 2
)
shift
goto parse_args

:args_done
echo.
echo !C_CYAN!╔══════════════════════════════════════════════════════════════════╗!C_RESET!
echo !C_CYAN!║!C_BOLD!!C_WHITE!                    H I P L A N  -  S E T U P                     !C_RESET!!C_CYAN!║!C_RESET!
echo !C_CYAN!║!C_GRAY!          Installazione Iniziale & Preparazione Ambiente          !C_RESET!!C_CYAN!║!C_RESET!
echo !C_CYAN!╚══════════════════════════════════════════════════════════════════╝!C_RESET!
echo.

echo !C_BOLD!─── Verifica Prerequisiti di Sistema ─────────────────────────────!C_RESET!

where py >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_CMD=py -3"
) else (
    where python >nul 2>&1
    if errorlevel 1 (
        set "FAILED_STEP=Verifica Python"
        set "FAILED_CMD=where python"
        echo [ERRORE] Python 3 non trovato nel PATH di Windows. > "%TEMP_LOG%"
        echo Scarica Python 3.9+ da https://www.python.org/downloads/ spuntando 'Add python.exe to PATH'. >> "%TEMP_LOG%"
        goto step_error
    )
    set "PYTHON_CMD=python"
)

%PYTHON_CMD% -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>&1
if errorlevel 1 (
    set "FAILED_STEP=Versione Python non compatibile"
    set "FAILED_CMD=%PYTHON_CMD% --version"
    echo [ERRORE] E' richiesto Python 3.9 o successivo. > "%TEMP_LOG%"
    %PYTHON_CMD% --version >> "%TEMP_LOG%" 2>&1
    goto step_error
)

for /f "usebackq delims=" %%v in (`%PYTHON_CMD% --version 2^>^&1`) do set "PY_VER=%%v"
echo !C_GREEN![✔]!C_RESET! !PY_VER! trovato.

where node >nul 2>&1
if errorlevel 1 (
    set "FAILED_STEP=Verifica Node.js"
    set "FAILED_CMD=where node"
    echo [ERRORE] Node.js non trovato nel PATH del sistema. > "%TEMP_LOG%"
    echo Scarica e installa Node.js LTS da https://nodejs.org/ >> "%TEMP_LOG%"
    goto step_error
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
    set "FAILED_STEP=Verifica npm"
    set "FAILED_CMD=where npm.cmd"
    echo [ERRORE] Gestore pacchetti npm non trovato nel sistema. > "%TEMP_LOG%"
    goto step_error
)

for /f "usebackq delims=" %%v in (`node --version 2^>^&1`) do set "NODE_VER=%%v"
powershell -NoProfile -Command "if ([version](node --version).TrimStart('v') -ge [version]'20.0.0') { exit 0 } else { exit 1 }" >nul 2>&1
if errorlevel 1 (
    set "FAILED_STEP=Versione Node.js non supportata"
    set "FAILED_CMD=node --version"
    echo [ERRORE] E' richiesto Node.js 20.x o successivo. Versione attuale: !NODE_VER! > "%TEMP_LOG%"
    goto step_error
)
echo !C_GREEN![✔]!C_RESET! Node.js !NODE_VER! trovato.
echo !C_GREEN![✔]!C_RESET! npm package manager disponibile.

if not exist "backend\.env" (
    copy /Y "backend\.env.example" "backend\.env" >nul 2>&1
    if errorlevel 1 (
        set "FAILED_STEP=Creazione backend\.env"
        set "FAILED_CMD=copy backend\.env.example backend\.env"
        echo [ERRORE] Impossibile creare backend\.env da .env.example. > "%TEMP_LOG%"
        goto step_error
    )
    echo !C_GREEN![✔]!C_RESET! File di configurazione backend\.env generato da .env.example.
) else (
    echo !C_GREEN![✔]!C_RESET! File di configurazione backend\.env presente.
)

echo.
echo !C_BOLD!─── [ 1/3 ] Preparazione Ambiente Python ──────────────────────────!C_RESET!
echo        !C_CYAN!!BAR_33!!C_RESET!  !C_GRAY!Configurazione venv e pip...!C_RESET!

if not exist "backend\venv\Scripts\python.exe" (
    echo [INFO] Creazione venv in corso... >> "%SETUP_LOG%"
    %PYTHON_CMD% -m venv "backend\venv" > "%TEMP_LOG%" 2>&1
    if errorlevel 1 (
        set "FAILED_STEP=Creazione Virtual Environment Python"
        set "FAILED_CMD=%PYTHON_CMD% -m venv backend\venv"
        goto step_error
    )
)

echo [INFO] Aggiornamento pip e wheel... >> "%SETUP_LOG%"
"backend\venv\Scripts\python.exe" -m pip install --upgrade pip setuptools wheel > "%TEMP_LOG%" 2>&1
if errorlevel 1 (
    set "FAILED_STEP=Aggiornamento pip / wheel"
    set "FAILED_CMD=pip install --upgrade pip setuptools wheel"
    goto step_error
)

echo [INFO] Installazione backend\requirements.txt... >> "%SETUP_LOG%"
"backend\venv\Scripts\python.exe" -m pip install -r "backend\requirements.txt" > "%TEMP_LOG%" 2>&1
if errorlevel 1 (
    set "FAILED_STEP=Installazione librerie Python (requirements.txt)"
    set "FAILED_CMD=pip install -r backend\requirements.txt"
    goto step_error
)
echo        !C_GREEN![✔] Ambiente Python configurato con successo.!C_RESET!

echo.
echo !C_BOLD!─── [ 2/3 ] Installazione Dipendenze Frontend ──────────────────────!C_RESET!
echo        !C_CYAN!!BAR_66!!C_RESET!  !C_GRAY!Installazione pacchetti npm (npm ci)...!C_RESET!
pushd "frontend"
call npm ci --prefer-offline --no-audit --no-fund > "%TEMP_LOG%" 2>&1
if errorlevel 1 (
    popd
    set "FAILED_STEP=Installazione pacchetti npm (npm ci)"
    set "FAILED_CMD=cd frontend && npm ci"
    goto step_error
)
popd
echo        !C_GREEN![✔] Dipendenze frontend installate con successo.!C_RESET!

echo.
echo !C_BOLD!─── [ 3/3 ] Verifica e Compilazione ────────────────────────────────!C_RESET!
echo        !C_CYAN!!BAR_100!!C_RESET!  !C_GRAY!Verifica import FastAPI e build Vite...!C_RESET!

pushd "backend"
"venv\Scripts\python.exe" -c "import app.main" > "%TEMP_LOG%" 2>&1
if errorlevel 1 (
    popd
    set "FAILED_STEP=Verifica integrita' backend FastAPI"
    set "FAILED_CMD=python -c 'import app.main'"
    goto step_error
)
popd

pushd "frontend"
call npm run build > "%TEMP_LOG%" 2>&1
if errorlevel 1 (
    popd
    set "FAILED_STEP=Compilazione frontend (npm run build)"
    set "FAILED_CMD=cd frontend && npm run build"
    goto step_error
)
popd
echo        !C_GREEN![✔] Moduli verificati e frontend compilato.!C_RESET!

if "%RUN_SEED%"=="1" (
    echo.
    echo !C_BOLD!─── [EXTRA] Inserimento Dati Dimostrativi ─────────────────────────────!C_RESET!
    pushd "backend"
    "venv\Scripts\python.exe" seed.py > "%TEMP_LOG%" 2>&1
    if errorlevel 1 (
        popd
        set "FAILED_STEP=Popolamento database con seed.py"
        set "FAILED_CMD=python seed.py"
        goto step_error
    )
    popd
    echo        !C_GREEN![✔] Dati dimostrativi inseriti con successo.!C_RESET!
)

if exist "%TEMP_LOG%" (
    type "%TEMP_LOG%" >> "%SETUP_LOG%"
    del /f /q "%TEMP_LOG%" >nul 2>&1
)

echo.
echo !C_GREEN!╔══════════════════════════════════════════════════════════════════╗!C_RESET!
echo !C_GREEN!║!C_BOLD!!C_WHITE!              CONFIGURAZIONE COMPLETATA CON SUCCESSO              !C_RESET!!C_GREEN!║!C_RESET!
echo !C_GREEN!╚══════════════════════════════════════════════════════════════════╝!C_RESET!
echo.
echo !C_BOLD!  Prossimi passi:!C_RESET!
echo     !C_GREEN!➜!C_RESET!  Avvia subito il server eseguendo:
echo        !C_CYAN!!C_BOLD!start_windows.bat!C_RESET!
echo.
echo     !C_GRAY!•  File impostazioni e configurazioni: backend\.env!C_RESET!
echo     !C_GRAY!•  Log completo salvato in: logs\setup.log!C_RESET!
echo.
if "%NO_PAUSE%"=="0" pause
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
echo   !C_BOLD!Ultime righe del log di errore:!C_RESET!
echo !C_RED!────────────────────────────────────────────────────────────────────!C_RESET!
if exist "%TEMP_LOG%" (
    powershell -NoProfile -Command "Get-Content '%TEMP_LOG%' -Tail 18 | ForEach-Object { '    ' + $_ }"
    type "%TEMP_LOG%" >> "%SETUP_LOG%"
) else (
    echo     Nessun dettaglio aggiuntivo disponibile nel file temporaneo.
)
echo !C_RED!────────────────────────────────────────────────────────────────────!C_RESET!
echo.
echo   !C_BOLD!Log completo disponibile in:!C_RESET! !C_CYAN!logs\setup.log!C_RESET!
echo.
if "%NO_PAUSE%"=="0" pause
exit /b 1

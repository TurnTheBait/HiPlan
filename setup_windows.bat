@echo off
setlocal EnableExtensions EnableDelayedExpansion
title HiPlan - Configurazione Windows
cd /d "%~dp0"

rem Evita che una variabile DEBUG globale sovrascriva backend\.env.
set "DEBUG="

set "NO_PAUSE=0"
set "RUN_SEED=0"

:parse_args
if "%~1"=="" goto args_done
if /I "%~1"=="--no-pause" (
    set "NO_PAUSE=1"
) else if /I "%~1"=="--seed" (
    set "RUN_SEED=1"
) else (
    echo [ERRORE] Opzione non riconosciuta: %~1
    echo Uso: setup_windows.bat [--seed] [--no-pause]
    exit /b 2
)
shift
goto parse_args

:args_done
echo ========================================================
echo   HiPlan - Configurazione Windows
echo ========================================================

where py >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_CMD=py -3"
) else (
    where python >nul 2>&1
    if errorlevel 1 (
        echo [ERRORE] Python 3 non trovato. Installa Python 3.12 o successivo.
        goto error
    )
    set "PYTHON_CMD=python"
)

%PYTHON_CMD% -c "import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)" >nul 2>&1
if errorlevel 1 (
    echo [ERRORE] Serve Python 3.12 o successivo.
    %PYTHON_CMD% --version
    goto error
)

where node >nul 2>&1
if errorlevel 1 (
    echo [ERRORE] Node.js non trovato. Installa Node.js 20.19 o successivo.
    goto error
)
where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo [ERRORE] npm non trovato. Reinstalla Node.js 20.19 o successivo.
    goto error
)
powershell -NoProfile -Command "if ([version](node --version).TrimStart('v') -ge [version]'20.19.0') { exit 0 } else { exit 1 }" >nul 2>&1
if errorlevel 1 (
    echo [ERRORE] Serve Node.js 20.19 o successivo.
    node --version
    goto error
)

if not exist "backend\.env" (
    copy /Y "backend\.env.example" "backend\.env" >nul
    if errorlevel 1 goto error
    echo [OK] Creato backend\.env da .env.example.
)

echo.
echo [1/3] Preparazione ambiente Python...
if not exist "backend\venv\Scripts\python.exe" (
    %PYTHON_CMD% -m venv "backend\venv"
    if errorlevel 1 goto error
)
"backend\venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto error
"backend\venv\Scripts\python.exe" -m pip install -r "backend\requirements.txt"
if errorlevel 1 goto error

echo.
echo [2/3] Installazione dipendenze frontend...
pushd "frontend"
call npm ci
if errorlevel 1 (
    popd
    goto error
)
popd

echo.
echo [3/3] Verifica installazione...
pushd "backend"
"venv\Scripts\python.exe" -c "import app.main"
if errorlevel 1 (
    popd
    goto error
)
popd
pushd "frontend"
call npm run build
if errorlevel 1 (
    popd
    goto error
)
popd

if "%RUN_SEED%"=="1" (
    echo.
    echo [EXTRA] Inserimento dati dimostrativi...
    pushd "backend"
    "venv\Scripts\python.exe" seed.py
    if errorlevel 1 (
        popd
        goto error
    )
    popd
)

echo.
echo ========================================================
echo   CONFIGURAZIONE COMPLETATA
echo   Avvia il gestionale con start_windows.bat
echo ========================================================
if "%NO_PAUSE%"=="0" pause
exit /b 0

:error
echo.
echo ========================================================
echo   CONFIGURAZIONE NON COMPLETATA
echo   Controlla il messaggio di errore sopra.
echo ========================================================
if "%NO_PAUSE%"=="0" pause
exit /b 1

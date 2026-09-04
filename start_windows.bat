@echo off
setlocal EnableExtensions EnableDelayedExpansion
title HiPlan - Avvio Windows
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

rem Evita che una variabile DEBUG globale sovrascriva backend\.env.
set "DEBUG="

echo.
echo !C_CYAN!╔══════════════════════════════════════════════════════════════════╗!C_RESET!
echo !C_CYAN!║!C_BOLD!!C_WHITE!                    H I P L A N  -  A V V I O                     !C_RESET!!C_CYAN!║!C_RESET!
echo !C_CYAN!║!C_GRAY!            Pianificazione Commesse & Gestione Risorse            !C_RESET!!C_CYAN!║!C_RESET!
echo !C_CYAN!╚══════════════════════════════════════════════════════════════════╝!C_RESET!
echo.

if not exist "backend\venv\Scripts\python.exe" goto setup_required
if not exist "frontend\node_modules" goto setup_required
goto setup_done

:setup_required
echo !C_YELLOW![i] Installazione incompleta rilevata: avvio configurazione iniziale...!C_RESET!
echo.
call "%~dp0scripts\setup_windows.bat" --no-pause
if errorlevel 1 goto error

:setup_done
echo !C_CYAN![i]!C_RESET! Verifica disponibilita' porte di rete...
netstat -aon | findstr /R /C:":8000 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo !C_RED![✖] ERRORE: La porta 8000 (Backend API) e' gia' occupata.!C_RESET!
    echo !C_YELLOW!    Esegui 'stop_windows.bat' per terminare le istanze precedenti.!C_RESET!
    goto error
)
netstat -aon | findstr /R /C:":5173 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo !C_RED![✖] ERRORE: La porta 5173 (Frontend Web) e' gia' occupata.!C_RESET!
    echo !C_YELLOW!    Esegui 'stop_windows.bat' per terminare le istanze precedenti.!C_RESET!
    goto error
)
echo !C_GREEN![✔]!C_RESET! Porte 8000 e 5173 libere.

if not exist "logs" mkdir "logs"

echo.
echo !C_BOLD!─── Avvio Servizi in Background ──────────────────────────────────!C_RESET!
echo !C_CYAN![1/2]!C_RESET! Avvio backend API FastAPI (porta 8000)...
"%SystemRoot%\System32\wscript.exe" "%~dp0run_backend_hidden.vbs"
if errorlevel 1 goto error

echo !C_CYAN![2/2]!C_RESET! Avvio frontend Web Vite (porta 5173)...
"%SystemRoot%\System32\wscript.exe" "%~dp0run_frontend_hidden.vbs"
if errorlevel 1 goto error

echo.
echo !C_CYAN![i]!C_RESET! Attesa disponibilita' dei servizi...
set "READY=0"
for /L %%i in (1,1,60) do (
    powershell -NoProfile -Command "try { $api=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8000/api/health' -TimeoutSec 2; $web=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173' -TimeoutSec 2; if($api.StatusCode -eq 200 -and $web.StatusCode -eq 200){exit 0}; exit 1 } catch { exit 1 }" >nul 2>&1
    if not errorlevel 1 (
        set "READY=1"
        goto services_ready
    )
    timeout /t 1 /nobreak >nul
)

:services_ready
if "!READY!"=="0" (
    echo.
    echo !C_RED!╔══════════════════════════════════════════════════════════════════╗!C_RESET!
    echo !C_RED!║!C_BOLD!!C_WHITE!                     I SERVIZI NON RISPONDONO                     !C_RESET!!C_RED!║!C_RESET!
    echo !C_RED!╚══════════════════════════════════════════════════════════════════╝!C_RESET!
    echo.
    echo   !C_BOLD!Ultime righe di logs\backend_app.log:!C_RESET!
    echo !C_RED!────────────────────────────────────────────────────────────────────!C_RESET!
    if exist "logs\backend_app.log" (
        powershell -NoProfile -Command "Get-Content 'logs\backend_app.log' -Tail 10 | ForEach-Object { '    ' + $_ }"
    ) else (
        echo     Nessun file di log trovato in logs\backend_app.log
    )
    echo !C_RED!────────────────────────────────────────────────────────────────────!C_RESET!
    echo.
    echo   !C_BOLD!Ultime righe di logs\frontend_app.log:!C_RESET!
    echo !C_RED!────────────────────────────────────────────────────────────────────!C_RESET!
    if exist "logs\frontend_app.log" (
        powershell -NoProfile -Command "Get-Content 'logs\frontend_app.log' -Tail 10 | ForEach-Object { '    ' + $_ }"
    ) else (
        echo     Nessun file di log trovato in logs\frontend_app.log
    )
    echo !C_RED!────────────────────────────────────────────────────────────────────!C_RESET!
    echo.
    call "%~dp0stop_windows.bat" --no-pause
    goto error
)

set "MY_IP="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "$ip=Get-NetIPConfiguration ^| Where-Object {$_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up'} ^| ForEach-Object {$_.IPv4Address.IPAddress} ^| Select-Object -First 1; if($ip){$ip}"`) do set "MY_IP=%%i"

start "" "http://localhost:5173"

echo.
echo !C_GREEN!╔══════════════════════════════════════════════════════════════════╗!C_RESET!
echo !C_GREEN!║!C_BOLD!!C_WHITE!                   HIPLAN AVVIATO CON SUCCESSO                    !C_RESET!!C_GREEN!║!C_RESET!
echo !C_GREEN!╚══════════════════════════════════════════════════════════════════╝!C_RESET!
echo.
echo !C_BOLD!  Indirizzi di accesso:!C_RESET!
echo     !C_GREEN!➜!C_RESET!  Questo PC:     !C_CYAN!!C_BOLD!http://localhost:5173!C_RESET!
if defined MY_IP (
    echo     !C_GREEN!➜!C_RESET!  Rete locale:   !C_CYAN!!C_BOLD!http://!MY_IP!:5173!C_RESET!
) else (
    echo     !C_GREEN!➜!C_RESET!  Rete locale:   !C_CYAN!!C_BOLD!http://IP-DEL-PC:5173!C_RESET!
)
echo     !C_GREEN!➜!C_RESET!  API Docs:      !C_GRAY!http://localhost:8000/docs!C_RESET!
echo.
echo !C_BOLD!  Gestione e Log:!C_RESET!
echo     !C_GRAY!•  Per arrestare:   stop_windows.bat!C_RESET!
echo     !C_GRAY!•  Log backend:     logs\backend_app.log!C_RESET!
echo     !C_GRAY!•  Log frontend:    logs\frontend_app.log!C_RESET!
echo.
echo !C_DIM!  Questa finestra si chiudera' automaticamente tra 8 secondi...!C_RESET!
timeout /t 8 /nobreak >nul
exit /b 0

:error
echo.
echo !C_RED!╔══════════════════════════════════════════════════════════════════╗!C_RESET!
echo !C_RED!║!C_BOLD!!C_WHITE!                ATTENZIONE: OPERAZIONE INTERROTTA                 !C_RESET!!C_RED!║!C_RESET!
echo !C_RED!╚══════════════════════════════════════════════════════════════════╝!C_RESET!
echo.
echo !C_YELLOW!Si e' verificato un problema durante l'avvio.!C_RESET!
echo !C_YELLOW!Consulta i dettagli del log sopra riportati o i file in logs\ per risolvere.!C_RESET!
echo.
pause
exit /b 1

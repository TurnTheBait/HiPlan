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
set "CURRENT_PCT=0"

echo.
echo !C_CYAN!╭──────────────────────────────────────────────────────────────────╮!C_RESET!
echo !C_CYAN!│!C_RESET!  !C_BOLD!!C_WHITE!◆  H I P L A N  ·  A V V I O  S E R V E R                       !C_RESET!!C_CYAN!│!C_RESET!
echo !C_CYAN!│!C_RESET!     !C_GRAY!Pianificazione Commesse & Gestione Risorse                   !C_RESET!!C_CYAN!│!C_RESET!
echo !C_CYAN!╰──────────────────────────────────────────────────────────────────╯!C_RESET!
echo.

if not exist "backend\venv\Scripts\python.exe" goto setup_required
if not exist "frontend\node_modules" goto setup_required
goto setup_done

:setup_required
echo   !C_YELLOW![!] Installazione incompleta rilevata: avvio configurazione...!C_RESET!
echo.
call "%~dp0scripts\setup_windows.bat" --no-pause
if errorlevel 1 goto error

:setup_done
call :advance_bar 15 "Controllo porte 8000 e 5173..."
set "BUSY_8000=0"
set "BUSY_5173=0"

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }" >nul 2>&1
if errorlevel 1 set "BUSY_8000=1"

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }" >nul 2>&1
if errorlevel 1 set "BUSY_5173=1"

rem Fallback netstat (multilingua EN / IT)
if "!BUSY_8000!"=="0" (
    netstat -aon | findstr /R /C:":8000 .*LISTENING" /C:":8000 .*ASCOLTO" >nul 2>&1
    if not errorlevel 1 set "BUSY_8000=1"
)
if "!BUSY_5173!"=="0" (
    netstat -aon | findstr /R /C:":5173 .*LISTENING" /C:":5173 .*ASCOLTO" >nul 2>&1
    if not errorlevel 1 set "BUSY_5173=1"
)

rem Se una porta e' occupata, arresta automaticamente le istanze precedenti
set "NEEDS_CLEANUP=0"
if "!BUSY_8000!"=="1" set "NEEDS_CLEANUP=1"
if "!BUSY_5173!"=="1" set "NEEDS_CLEANUP=1"

if "!NEEDS_CLEANUP!"=="1" (
    call :advance_bar 20 "Pulizia porte occupate..."
    call "%~dp0stop_windows.bat" --no-pause >nul 2>&1
    timeout /t 1 /nobreak >nul

    set "BUSY_8000=0"
    set "BUSY_5173=0"
    powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }" >nul 2>&1
    if errorlevel 1 set "BUSY_8000=1"
    powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }" >nul 2>&1
    if errorlevel 1 set "BUSY_5173=1"

    if "!BUSY_8000!"=="1" (
        call :fail_bar "Porta 8000 occupata da un'altra app"
        goto error
    )
    if "!BUSY_5173!"=="1" (
        call :fail_bar "Porta 5173 occupata da un'altra app"
        goto error
    )
)
call :advance_bar 25 "Porte di rete libere e pronte"

if not exist "logs" mkdir "logs"

call :advance_bar 40 "Avvio Backend FastAPI (8000)..."
set "VBS_FAIL=0"
if exist "%SystemRoot%\System32\wscript.exe" (
    "%SystemRoot%\System32\wscript.exe" "%~dp0run_backend_hidden.vbs"
    if errorlevel 1 set "VBS_FAIL=1"
) else (
    set "VBS_FAIL=1"
)
if "!VBS_FAIL!"=="1" (
    powershell -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/d /c venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level info > ..\logs\backend_app.log 2>&1' -WorkingDirectory '%~dp0backend' -WindowStyle Hidden"
)
call :advance_bar 50 "Backend API FastAPI attivo"

call :advance_bar 65 "Avvio Frontend Vite (5173)..."
set "VBS_FAIL=0"
if exist "%SystemRoot%\System32\wscript.exe" (
    "%SystemRoot%\System32\wscript.exe" "%~dp0run_frontend_hidden.vbs"
    if errorlevel 1 set "VBS_FAIL=1"
) else (
    set "VBS_FAIL=1"
)
if "!VBS_FAIL!"=="1" (
    powershell -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/d /c npm run dev -- --host 0.0.0.0 --port 5173 > ..\logs\frontend_app.log 2>&1' -WorkingDirectory '%~dp0frontend' -WindowStyle Hidden"
)
call :advance_bar 70 "Frontend Web Vite attivo"

where curl.exe >nul 2>&1
if not errorlevel 1 (
    set "HAS_CURL=1"
) else (
    set "HAS_CURL=0"
)

set "READY=0"
for /L %%i in (1,1,45) do (
    set /a "POLL_PCT=70 + (%%i * 25 / 45)"
    call :draw_bar !POLL_PCT! "Verifica risposta HTTP (%%is)..."

    if "!HAS_CURL!"=="1" (
        curl.exe -fsS -m 2 "http://127.0.0.1:8000/api/health" >nul 2>&1
        if not errorlevel 1 (
            curl.exe -fsS -m 2 "http://127.0.0.1:5173" >nul 2>&1
            if not errorlevel 1 (
                set "READY=1"
                goto services_ready
            )
        )
    ) else (
        powershell -NoProfile -Command "$a = try { (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8000/api/health' -TimeoutSec 2).StatusCode } catch { 0 }; $w = try { (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173' -TimeoutSec 2).StatusCode } catch { 0 }; if ($a -eq 200 -and $w -eq 200) { exit 0 } else { exit 1 }" >nul 2>&1
        if not errorlevel 1 (
            set "READY=1"
            goto services_ready
        )
    )
    timeout /t 1 /nobreak >nul
)

:services_ready
if "!READY!"=="0" (
    call :fail_bar "I servizi non rispondono in tempo"
    echo.
    echo !C_RED!╭──────────────────────────────────────────────────────────────────╮!C_RESET!
    echo !C_RED!│!C_RESET!  !C_BOLD!!C_WHITE!✖  I SERVIZI NON RISPONDONO                                     !C_RESET!!C_RED!│!C_RESET!
    echo !C_RED!╰──────────────────────────────────────────────────────────────────╯!C_RESET!
    echo.
    echo   !C_BOLD!Diagnostica stato porte:!C_RESET!
    powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) { Write-Host '    [✔] Backend porta 8000 in ascolto' -ForegroundColor Green } else { Write-Host '    [✖] Backend porta 8000 NON risponde' -ForegroundColor Red }"
    powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) { Write-Host '    [✔] Frontend porta 5173 in ascolto' -ForegroundColor Green } else { Write-Host '    [✖] Frontend porta 5173 NON risponde' -ForegroundColor Red }"
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

call :advance_bar 100 "Tutti i servizi online!"
call :finish_bar "HiPlan avviato e sincronizzato con successo!"

set "MY_IP="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "$ip=Get-NetIPConfiguration ^| Where-Object {$_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up'} ^| ForEach-Object {$_.IPv4Address.IPAddress} ^| Select-Object -First 1; if($ip){$ip}"`) do set "MY_IP=%%i"
if not defined MY_IP (
    for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
        if not defined MY_IP (
            for /f "tokens=1 delims= " %%b in ("%%a") do set "MY_IP=%%b"
        )
    )
)

start "" "http://localhost:5173"

echo !C_GREEN!╭──────────────────────────────────────────────────────────────────╮!C_RESET!
echo !C_GREEN!│!C_RESET!  !C_BOLD!!C_WHITE!✔  HIPLAN AVVIATO CON SUCCESSO                                  !C_RESET!!C_GREEN!│!C_RESET!
echo !C_GREEN!╰──────────────────────────────────────────────────────────────────╯!C_RESET!
echo.
echo !C_BOLD!  Indirizzi di Accesso:!C_RESET!
echo     !C_GREEN!●!C_RESET!  Questo PC:      !C_CYAN!!C_BOLD!http://localhost:5173!C_RESET!
if defined MY_IP (
    echo     !C_GREEN!●!C_RESET!  Rete Locale:    !C_CYAN!!C_BOLD!http://!MY_IP!:5173!C_RESET!
) else (
    echo     !C_GREEN!●!C_RESET!  Rete Locale:    !C_CYAN!!C_BOLD!http://IP-DEL-PC:5173!C_RESET!
)
echo     !C_GREEN!●!C_RESET!  Documentazione: !C_GRAY!http://localhost:8000/docs!C_RESET!
echo.
echo !C_BOLD!  Gestione Operativa:!C_RESET!
echo     !C_GRAY!·  Arresto rapido:  stop_windows.bat!C_RESET!
echo     !C_GRAY!·  Log Backend:     logs\backend_app.log!C_RESET!
echo     !C_GRAY!·  Log Frontend:    logs\frontend_app.log!C_RESET!
echo.
echo !C_DIM!  Questa finestra si chiudera' automaticamente tra 8 secondi...!C_RESET!
timeout /t 8 /nobreak >nul
exit /b 0

:error
echo.
echo !C_RED!╭──────────────────────────────────────────────────────────────────╮!C_RESET!
echo !C_RED!│!C_RESET!  !C_BOLD!!C_WHITE!✖  ATTENZIONE: OPERAZIONE INTERROTTA                             !C_RESET!!C_RED!│!C_RESET!
echo !C_RED!╰──────────────────────────────────────────────────────────────────╯!C_RESET!
echo.
echo !C_YELLOW!Si e' verificato un problema durante l'avvio.!C_RESET!
echo !C_YELLOW!Consulta i dettagli del log sopra riportati o i file in logs\ per risolvere.!C_RESET!
echo.
pause
exit /b 1

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

:fail_bar
setlocal EnableDelayedExpansion
set "TEXT=%~1"
set /a "NUM_F=CURRENT_PCT * 18 / 100"
set /a "NUM_E=18 - NUM_F"
set "BAR_F="
set "BAR_E="
for /L %%x in (1,1,!NUM_F!) do set "BAR_F=!BAR_F!█"
for /L %%x in (1,1,!NUM_E!) do set "BAR_E=!BAR_E!░"
if defined ESC (
    echo !ESC![2K!ESC![1G  !C_GRAY![!C_RED!!BAR_F!!C_GRAY!!BAR_E!]!C_RESET! !C_BOLD!!C_RED!!CURRENT_PCT!%%!C_RESET!  !C_BOLD!!C_RED!✖ !TEXT!!C_RESET!
) else (
    echo.
    echo   [!BAR_F!!BAR_E!] !CURRENT_PCT!%%  ✖ !TEXT!
)
echo.
endlocal
exit /b 0

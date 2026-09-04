@echo off
setlocal EnableExtensions EnableDelayedExpansion
title HiPlan - Avvio Windows
cd /d "%~dp0"

rem Evita che una variabile DEBUG globale sovrascriva backend\.env.
set "DEBUG="

echo ========================================================
echo   HiPlan - Avvio servizi Windows
echo ========================================================

if not exist "backend\venv\Scripts\python.exe" goto setup_required
if not exist "frontend\node_modules" goto setup_required
goto setup_done

:setup_required
echo [INFO] Installazione incompleta: avvio della configurazione iniziale.
call "%~dp0scripts\setup_windows.bat" --no-pause
if errorlevel 1 goto error

:setup_done
netstat -aon | findstr /R /C:":8000 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [ERRORE] La porta 8000 e' gia' occupata.
    echo Arresta la precedente istanza di HiPlan e riprova.
    goto error
)
netstat -aon | findstr /R /C:":5173 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [ERRORE] La porta 5173 e' gia' occupata.
    echo Arresta la precedente istanza di HiPlan e riprova.
    goto error
)

if not exist "logs" mkdir "logs"

echo.
echo [1/2] Avvio backend API sulla porta 8000...
"%SystemRoot%\System32\wscript.exe" "%~dp0run_backend_hidden.vbs"
if errorlevel 1 goto error

echo [2/2] Avvio frontend sulla porta 5173...
"%SystemRoot%\System32\wscript.exe" "%~dp0run_frontend_hidden.vbs"
if errorlevel 1 goto error

echo.
echo Attesa disponibilita' dei servizi...
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
    echo [ERRORE] I servizi non sono diventati disponibili.
    echo Controlla logs\backend_app.log e logs\frontend_app.log.
    call "%~dp0stop_windows.bat" --no-pause
    goto error
)

set "MY_IP="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "$ip=Get-NetIPConfiguration ^| Where-Object {$_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up'} ^| ForEach-Object {$_.IPv4Address.IPAddress} ^| Select-Object -First 1; if($ip){$ip}"`) do set "MY_IP=%%i"

start "" "http://localhost:5173"

echo.
echo ========================================================
echo   HIPLAN AVVIATO
echo   Questo PC: http://localhost:5173
if defined MY_IP (
    echo   Rete locale: http://!MY_IP!:5173
) else (
    echo   Rete locale: http://IP-DEL-PC:5173
)
echo.
echo   Arresto: stop_windows.bat
echo   Log: logs\backend_app.log e logs\frontend_app.log
echo ========================================================
timeout /t 8 /nobreak >nul
exit /b 0

:error
echo.
echo Avvio non completato.
pause
exit /b 1

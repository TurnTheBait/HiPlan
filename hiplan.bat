@echo off
setlocal EnableExtensions EnableDelayedExpansion
title HiPlan - Console di Gestione
cd /d "%~dp0"
chcp 65001 >nul

rem Configurazione colori ANSI (Windows Terminal / Windows 10 e 11)
for /F %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"
if defined ESC (
    set "C_RESET=!ESC![0m"
    set "C_BOLD=!ESC![1m"
    set "C_DIM=!ESC![2m"
    set "C_RED=!ESC![91m"
    set "C_GREEN=!ESC![92m"
    set "C_YELLOW=!ESC![93m"
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
    set "C_CYAN="
    set "C_WHITE="
    set "C_GRAY="
)

rem Evita che variabili esterne interferiscano
set "DEBUG="
set "LAST_LOG="

if not exist "logs" mkdir "logs"

rem Dispatcher argomenti CLI o menu interattivo
set "ACTION=%~1"
if /I "%ACTION%"=="start" goto cmd_start
if /I "%ACTION%"=="--start" goto cmd_start
if /I "%ACTION%"=="stop" goto cmd_stop
if /I "%ACTION%"=="--stop" goto cmd_stop
if /I "%ACTION%"=="update" goto cmd_update
if /I "%ACTION%"=="--update" goto cmd_update
if /I "%ACTION%"=="setup" goto cmd_setup
if /I "%ACTION%"=="--setup" goto cmd_setup
if /I "%ACTION%"=="help" goto cmd_help
if /I "%ACTION%"=="--help" goto cmd_help
if /I "%ACTION%"=="-h" goto cmd_help

if "%ACTION%"=="" goto menu

echo Opzione non riconosciuta: %ACTION%
echo Uso: hiplan.bat [start - stop - update - setup]
pause
exit /b 1

rem ============================================================
rem MENU INTERATTIVO
rem ============================================================
:menu
cls
echo.
echo !C_CYAN!------------------------------------------------------------!C_RESET!
echo   !C_BOLD!!C_WHITE!H I P L A N!C_RESET!  !C_GRAY!-!C_RESET!  !C_DIM!Pannello di Controllo!C_RESET!
echo !C_CYAN!------------------------------------------------------------!C_RESET!
echo.
echo   !C_CYAN!1!C_RESET!)  !C_WHITE!Avvia Server!C_RESET!       !C_GRAY!(start)!C_RESET!
echo   !C_CYAN!2!C_RESET!)  !C_WHITE!Arresta Server!C_RESET!     !C_GRAY!(stop)!C_RESET!
echo   !C_CYAN!3!C_RESET!)  !C_WHITE!Aggiorna Sistema!C_RESET!   !C_GRAY!(update)!C_RESET!
echo   !C_CYAN!4!C_RESET!)  !C_WHITE!Configurazione!C_RESET!     !C_GRAY!(setup)!C_RESET!
echo   !C_GRAY!0!C_RESET!)  !C_GRAY!Esci!C_RESET!
echo.
echo !C_CYAN!------------------------------------------------------------!C_RESET!
set "CHOICE="
set /p "CHOICE=  Scegli un'opzione [0-4]: "
if defined CHOICE set "CHOICE=!CHOICE: =!"
if "!CHOICE!"=="1" goto cmd_start
if /I "!CHOICE!"=="start" goto cmd_start
if "!CHOICE!"=="2" goto cmd_stop
if /I "!CHOICE!"=="stop" goto cmd_stop
if "!CHOICE!"=="3" goto cmd_update
if /I "!CHOICE!"=="update" goto cmd_update
if "!CHOICE!"=="4" goto cmd_setup
if /I "!CHOICE!"=="setup" goto cmd_setup
if "!CHOICE!"=="0" exit /b 0
if /I "!CHOICE!"=="q" exit /b 0
if /I "!CHOICE!"=="exit" exit /b 0
echo.
echo   !C_RED![!] Scelta non valida.!C_RESET!
timeout /t 1 /nobreak >nul
goto menu

:cmd_help
echo Uso: hiplan.bat [start - stop - update - setup]
pause
exit /b 0

rem ============================================================
rem AZIONE: START
rem ============================================================
:cmd_start
call :header "Avvio Sistema"

if not exist "backend\venv\Scripts\python.exe" goto start_needs_setup
if not exist "frontend\node_modules" goto start_needs_setup
goto start_checks

:start_needs_setup
echo   !C_YELLOW![i] Installazione incompleta: avvio configurazione iniziale...!C_RESET!
echo.
call :do_setup_core
if errorlevel 1 goto error_exit
echo.

:start_checks
call :draw_bar 10 "Controllo porte di rete..."

set "BUSY_8000=0"
set "BUSY_5173=0"
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }" >nul 2>&1
if errorlevel 1 set "BUSY_8000=1"
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }" >nul 2>&1
if errorlevel 1 set "BUSY_5173=1"

if "!BUSY_8000!"=="1" goto clean_ports
if "!BUSY_5173!"=="1" goto clean_ports
goto ports_ok

:clean_ports
call :draw_bar 20 "Rilascio porte occupate..."
call :do_stop_silent
timeout /t 1 /nobreak >nul

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }" >nul 2>&1
if errorlevel 1 (
    call :fail_bar 25 "Porta 8000 occupata da altra applicazione"
    goto error_exit
)
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }" >nul 2>&1
if errorlevel 1 (
    call :fail_bar 25 "Porta 5173 occupata da altra applicazione"
    goto error_exit
)

:ports_ok
call :draw_bar 35 "Porte 8000 e 5173 pronte"

call :draw_bar 45 "Avvio Backend API..."
powershell -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/d /c venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level info > ..\logs\backend_app.log 2>&1' -WorkingDirectory '%~dp0backend' -WindowStyle Hidden"

call :draw_bar 60 "Avvio Frontend Vite..."
powershell -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/d /c npm run dev -- --host 0.0.0.0 --port 5173 > ..\logs\frontend_app.log 2>&1' -WorkingDirectory '%~dp0frontend' -WindowStyle Hidden"

set "READY=0"
for /L %%i in (1,1,40) do (
    set /a "PCT=65 + (%%i * 30 / 40)"
    call :draw_bar !PCT! "Attesa risposta HTTP (%%is)..."
    where curl.exe >nul 2>&1
    if not errorlevel 1 (
        curl.exe -fsS -m 2 "http://127.0.0.1:8000/api/health" >nul 2>&1
        if not errorlevel 1 (
            curl.exe -fsS -m 2 "http://127.0.0.1:5173" >nul 2>&1
            if not errorlevel 1 (
                set "READY=1"
                goto start_ready
            )
        )
    ) else (
        powershell -NoProfile -Command "$a = try { (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8000/api/health' -TimeoutSec 2).StatusCode } catch { 0 }; $w = try { (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173' -TimeoutSec 2).StatusCode } catch { 0 }; if ($a -eq 200 -and $w -eq 200) { exit 0 } else { exit 1 }" >nul 2>&1
        if not errorlevel 1 (
            set "READY=1"
            goto start_ready
        )
    )
    timeout /t 1 /nobreak >nul
)

:start_ready
if "!READY!"=="0" (
    call :fail_bar 75 "I servizi non rispondono in tempo"
    echo   !C_YELLOW!Dettagli log:!C_RESET!
    echo     - logs\backend_app.log
    echo     - logs\frontend_app.log
    call :do_stop_silent
    goto error_exit
)

call :finish_bar "Server avviato e sincronizzato!"

set "MY_IP="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "$ip=Get-NetIPConfiguration ^| Where-Object {$_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up'} ^| ForEach-Object {$_.IPv4Address.IPAddress} ^| Select-Object -First 1; if($ip){$ip}"`) do set "MY_IP=%%i"

start "" "http://localhost:5173"

echo !C_GREEN!------------------------------------------------------------!C_RESET!
echo   !C_BOLD!!C_WHITE!PUNTI DI ACCESSO HIPLAN!C_RESET!
echo !C_GREEN!------------------------------------------------------------!C_RESET!
echo   !C_GREEN!^>!C_RESET!  Questo PC:       !C_CYAN!!C_BOLD!http://localhost:5173!C_RESET!
if defined MY_IP (
    echo   !C_GREEN!^>!C_RESET!  Rete Locale:     !C_CYAN!!C_BOLD!http://!MY_IP!:5173!C_RESET!
)
echo   !C_GREEN!^>!C_RESET!  Documentazione:  !C_GRAY!http://localhost:8000/docs!C_RESET!
echo !C_GREEN!------------------------------------------------------------!C_RESET!
echo   !C_GRAY!I servizi sono attivi in background.!C_RESET!
echo.
echo Premi un tasto per tornare al menu principale...
pause >nul
goto menu

rem ============================================================
rem AZIONE: STOP
rem ============================================================
:cmd_stop
call :header "Arresto Servizi"
call :draw_bar 30 "Chiusura Backend API..."
call :do_stop_port 8000
call :draw_bar 65 "Chiusura Frontend Web..."
call :do_stop_port 5173
call :draw_bar 90 "Pulizia processi residui..."
powershell -NoProfile -Command "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*app.main:app*' -or $_.CommandLine -like '*vite*' -or $_.CommandLine -like '*npm run dev*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
taskkill /F /IM uvicorn.exe >nul 2>&1
call :finish_bar "Tutti i servizi HiPlan sono stati arrestati!"
echo Premi un tasto per tornare al menu...
pause >nul
goto menu

rem ============================================================
rem AZIONE: UPDATE
rem ============================================================
:cmd_update
call :header "Aggiornamento HiPlan"
set "LAST_LOG="

if not exist "backend\venv\Scripts\python.exe" goto update_run_setup
if not exist "frontend\node_modules" goto update_run_setup
goto update_start

:update_run_setup
echo   !C_YELLOW![i] Ambiente non ancora configurato: avvio configurazione iniziale...!C_RESET!
echo.
call :do_setup_core
if errorlevel 1 goto error_exit
echo.

:update_start
if not exist "backend\.env" (
    if exist "backend\.env.example" copy /Y "backend\.env.example" "backend\.env" >nul 2>&1
)

call :draw_bar 10 "Arresto servizi attivi..."
call :do_stop_silent

call :draw_bar 25 "Backup di sicurezza database..."
if exist "backend\venv\Scripts\python.exe" (
    "backend\venv\Scripts\python.exe" -c "import sys; sys.path.append('backend'); from app.services.backup_service import run_backup; run_backup()" > "logs\backup.log" 2>&1
)

call :draw_bar 40 "Aggiornamento pip e wheel..."
"backend\venv\Scripts\python.exe" -m pip install --quiet --upgrade pip setuptools wheel > "logs\update_pip.log" 2>&1

call :draw_bar 55 "Aggiornamento librerie Python..."
"backend\venv\Scripts\python.exe" -m pip install --quiet -r "backend\requirements.txt" >> "logs\update_pip.log" 2>&1
if errorlevel 1 (
    call :fail_bar 55 "Errore aggiornamento librerie Python"
    set "LAST_LOG=logs\update_pip.log"
    goto error_exit
)

call :draw_bar 75 "Installazione pacchetti npm..."
cmd /c "npm --prefix frontend install --prefer-offline --no-audit --no-fund" > "logs\update_npm.log" 2>&1
if errorlevel 1 (
    call :fail_bar 75 "Errore installazione pacchetti npm"
    set "LAST_LOG=logs\update_npm.log"
    goto error_exit
)

call :draw_bar 90 "Compilazione bundle frontend..."
cmd /c "npm --prefix frontend run build" > "logs\update_build.log" 2>&1
if errorlevel 1 (
    call :fail_bar 90 "Errore compilazione frontend Vite"
    set "LAST_LOG=logs\update_build.log"
    goto error_exit
)

call :draw_bar 96 "Verifica integrita' backend..."
"backend\venv\Scripts\python.exe" -c "import sys; sys.path.append('backend'); import app.main" > "logs\update_check.log" 2>&1
if errorlevel 1 (
    call :fail_bar 96 "Errore verifica integrita' backend"
    set "LAST_LOG=logs\update_check.log"
    goto error_exit
)

call :finish_bar "HiPlan aggiornato con successo!"
echo   !C_GRAY!Per riavviare il server: seleziona 1 dal menu (start)!C_RESET!
echo.
echo Premi un tasto per tornare al menu...
pause >nul
goto menu

rem ============================================================
rem AZIONE: SETUP
rem ============================================================
:cmd_setup
call :header "Configurazione Ambiente"
call :do_setup_core
if errorlevel 1 goto error_exit
echo.
echo Premi un tasto per tornare al menu...
pause >nul
goto menu

:do_setup_core
call :draw_bar 10 "Verifica Python 3 e Node.js..."

set "PY_EXEC="
where py >nul 2>&1
if not errorlevel 1 set "PY_EXEC=py -3"
if not defined PY_EXEC (
    where python >nul 2>&1
    if not errorlevel 1 set "PY_EXEC=python"
)

rem Controllo percorsi standard Windows se Python non e' nel PATH
if not defined PY_EXEC (
    for /d %%D in ("%LocalAppData%\Programs\Python\Python3*") do (
        if exist "%%~D\python.exe" set "PY_EXEC="%%~D\python.exe""
    )
)
if not defined PY_EXEC (
    for /d %%D in ("%ProgramFiles%\Python3*") do (
        if exist "%%~D\python.exe" set "PY_EXEC="%%~D\python.exe""
    )
)
if not defined PY_EXEC (
    for /d %%D in ("C:\Python3*") do (
        if exist "%%~D\python.exe" set "PY_EXEC="%%~D\python.exe""
    )
)

if not defined PY_EXEC (
    call :fail_bar 15 "Python non trovato nel sistema"
    echo   !C_YELLOW!Installa Python 3.9+ da python.org spuntando 'Add python.exe to PATH'.!C_RESET!
    exit /b 1
)

!PY_EXEC! -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>&1
if errorlevel 1 (
    call :fail_bar 15 "Richiesto Python 3.9 o successivo"
    exit /b 1
)

set "NODE_EXEC="
where node >nul 2>&1
if not errorlevel 1 set "NODE_EXEC=node"
if not defined NODE_EXEC (
    if exist "%ProgramFiles%\nodejs\node.exe" (
        set "NODE_EXEC="%ProgramFiles%\nodejs\node.exe""
        set "PATH=%ProgramFiles%\nodejs;!PATH!"
    )
)

if not defined NODE_EXEC (
    call :fail_bar 15 "Node.js non trovato nel PATH di Windows"
    echo   !C_YELLOW!Installa Node.js LTS da nodejs.org.!C_RESET!
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    if exist "%ProgramFiles%\nodejs\npm.cmd" (
        set "PATH=%ProgramFiles%\nodejs;!PATH!"
    ) else (
        call :fail_bar 15 "npm non trovato nel PATH di Windows"
        exit /b 1
    )
)

if not exist "backend\.env" (
    if exist "backend\.env.example" copy /Y "backend\.env.example" "backend\.env" >nul 2>&1
)

call :draw_bar 25 "Creazione virtualenv Python..."
if not exist "backend\venv\Scripts\python.exe" (
    !PY_EXEC! -m venv "backend\venv" > "logs\setup.log" 2>&1
)

call :draw_bar 40 "Aggiornamento pip e wheel..."
"backend\venv\Scripts\python.exe" -m pip install --quiet --upgrade pip setuptools wheel >> "logs\setup.log" 2>&1

call :draw_bar 60 "Installazione librerie Python..."
"backend\venv\Scripts\python.exe" -m pip install --quiet -r "backend\requirements.txt" >> "logs\setup.log" 2>&1
if errorlevel 1 (
    call :fail_bar 60 "Errore installazione requirements.txt"
    set "LAST_LOG=logs\setup.log"
    exit /b 1
)

call :draw_bar 80 "Installazione moduli npm..."
cmd /c "npm --prefix frontend install --prefer-offline --no-audit --no-fund" >> "logs\setup.log" 2>&1
if errorlevel 1 (
    call :fail_bar 80 "Errore installazione moduli npm"
    set "LAST_LOG=logs\setup.log"
    exit /b 1
)

call :draw_bar 95 "Compilazione frontend Vite..."
cmd /c "npm --prefix frontend run build" >> "logs\setup.log" 2>&1
if errorlevel 1 (
    call :fail_bar 95 "Errore compilazione frontend Vite"
    set "LAST_LOG=logs\setup.log"
    exit /b 1
)

call :finish_bar "Configurazione iniziale completata!"
echo   !C_GRAY!Puoi avviare il server eseguendo l'opzione 1 dal menu (start)!C_RESET!
echo.
exit /b 0

rem ============================================================
rem HELPER: ARRESTO PORTE E SERVIZI
rem ============================================================
:do_stop_port
set "PORT=%~1"
powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; if ($p) { $p | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; exit 0 } else { exit 1 }" >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr :%PORT% ^| findstr /I "LISTENING"') do taskkill /F /T /PID %%a >nul 2>&1
for /f "tokens=6" %%a in ('netstat -aon 2^>nul ^| findstr :%PORT% ^| findstr /I "ASCOLTO"') do taskkill /F /T /PID %%a >nul 2>&1
exit /b 0

:do_stop_silent
call :do_stop_port 8000
call :do_stop_port 5173
powershell -NoProfile -Command "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*app.main:app*' -or $_.CommandLine -like '*vite*' -or $_.CommandLine -like '*npm run dev*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
taskkill /F /IM uvicorn.exe >nul 2>&1
exit /b 0

rem ============================================================
rem SUBROUTINES GRAFICHE MODERNE
rem ============================================================
:header
echo.
echo !C_CYAN!------------------------------------------------------------!C_RESET!
echo   !C_BOLD!!C_WHITE!HIPLAN!C_RESET!  !C_GRAY!-!C_RESET!  !C_WHITE!%~1!C_RESET!
echo !C_CYAN!------------------------------------------------------------!C_RESET!
echo.
exit /b 0

:draw_bar
setlocal EnableDelayedExpansion
set "PCT=%~1"
set "TEXT=%~2"
set /a "NUM_F=PCT * 16 / 100"
set /a "NUM_E=16 - NUM_F"
set "BAR_F="
set "BAR_E="
for /L %%x in (1,1,!NUM_F!) do set "BAR_F=!BAR_F!█"
for /L %%x in (1,1,!NUM_E!) do set "BAR_E=!BAR_E!░"

set "SP= "
if !PCT! LSS 100 set "SP=  "
if !PCT! LSS 10 set "SP=   "

if defined ESC (
    <nul set /p "=!ESC![2K!ESC![1G  !C_GRAY![!C_CYAN!!BAR_F!!C_GRAY!!BAR_E!]!C_RESET! !C_WHITE!!PCT!%%!C_RESET!!SP!!C_GRAY!!TEXT!!C_RESET!"
) else (
    echo   [!BAR_F!!BAR_E!] !PCT!%% !TEXT!
)
endlocal
exit /b 0

:finish_bar
setlocal EnableDelayedExpansion
set "TEXT=%~1"
set "BAR_F="
for /L %%x in (1,1,16) do set "BAR_F=!BAR_F!█"
if defined ESC (
    echo !ESC![2K!ESC![1G  !C_GRAY![!C_GREEN!!BAR_F!!C_GRAY!]!C_RESET! !C_BOLD!!C_GREEN!100%%!C_RESET!  !C_BOLD!!C_GREEN![OK] !TEXT!!C_RESET!
) else (
    echo   [!BAR_F!] 100%%  [OK] !TEXT!
)
echo.
endlocal
exit /b 0

:fail_bar
setlocal EnableDelayedExpansion
set "PCT=%~1"
set "TEXT=%~2"
set /a "NUM_F=PCT * 16 / 100"
set /a "NUM_E=16 - NUM_F"
set "BAR_F="
set "BAR_E="
for /L %%x in (1,1,!NUM_F!) do set "BAR_F=!BAR_F!█"
for /L %%x in (1,1,!NUM_E!) do set "BAR_E=!BAR_E!░"
if defined ESC (
    echo !ESC![2K!ESC![1G  !C_GRAY![!C_RED!!BAR_F!!C_GRAY!!BAR_E!]!C_RESET! !C_BOLD!!C_RED!!PCT!%%!C_RESET!  !C_BOLD!!C_RED![ERRORE] !TEXT!!C_RESET!
) else (
    echo   [!BAR_F!!BAR_E!] !PCT!%%  [ERRORE] !TEXT!
)
echo.
endlocal
exit /b 0

:error_exit
echo.
echo   !C_RED![!] Operazione interrotta per un errore.!C_RESET!
if defined LAST_LOG (
    if exist "!LAST_LOG!" (
        echo.
        echo   !C_YELLOW!Ultime righe dal log !LAST_LOG!:!C_RESET!
        powershell -NoProfile -Command "Get-Content '!LAST_LOG!' -Tail 8 | ForEach-Object { '    ' + $_ }" 2>nul
        echo.
    )
)
echo   !C_GRAY!Consulta i file di log nella cartella logs\ per maggiori dettagli.!C_RESET!
echo.
echo Premi un tasto per tornare al menu...
pause >nul
goto menu

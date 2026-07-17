@echo off
for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr /i "IPv4"') do (
    for /f "tokens=1 delims= " %%j in ("%%i") do set MY_IP=%%j
)
if not defined MY_IP set MY_IP=192.168.2.10

title HiPlan - Server Aziendale (%MY_IP%)
echo ========================================================
echo         AVVIO DEL SERVIZIO HIPLAN SU WINDOWS
echo ========================================================
echo.

cd /d "%~dp0"

if not exist "backend\venv\Scripts\activate.bat" (
    echo [ATTENZIONE] Ambiente virtuale non trovato! Avvio installazione automatica prima dell'accensione...
    call setup_windows.bat
)

if not exist "logs" mkdir logs

echo [1/2] Avvio del Backend API in background sulla porta 8000...
wscript run_backend_hidden.vbs

echo [2/2] Avvio del Frontend Web in background sulla porta 5173...
wscript run_frontend_hidden.vbs

echo.
echo Attendere qualche secondo per l'accensione dei servizi...
timeout /t 3 /nobreak > nul

echo.
echo ===================================================================
echo ✅ SERVER HIPLAN AVVIATO IN BACKGROUND CON SUCCESSO!
echo ===================================================================
echo.
echo 🌐 Da qualsiasi PC (Windows o Mac) in ufficio digita nel browser:
echo    http://%MY_IP%:5173
echo.
echo 💻 Direttamente da questo Server Windows digita:
echo    http://localhost:5173
echo.
echo ===================================================================
echo NOTA SU ARRESTO, FIREWALL E LOG:
echo - I servizi sono attivi in background senza finestre nere aperte.
echo - Per ARRESTARE l'applicazione in qualsiasi momento, fai doppio
echo   clic sul file: stop_windows.bat
echo - Se dai PC dell'ufficio non si apre la pagina, fai CLIC DESTRO sul
echo   file "allow_firewall_windows.bat" e scegli "Esegui come amministratore".
echo - I log degli errori sono consultabili nella cartella dedicata: logs\
echo ===================================================================
echo.
echo Questa finestra di conferma si chiudera' automaticamente tra 10 secondi...
timeout /t 10 > nul

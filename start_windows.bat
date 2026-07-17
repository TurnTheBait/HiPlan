@echo off
title HiPlan - Server Aziendale (192.168.2.10)
echo ========================================================
echo         AVVIO DEL SERVIZIO HIPLAN SU WINDOWS
echo ========================================================
echo.

cd /d "%~dp0"

if not exist "backend\venv\Scripts\activate.bat" (
    echo [ATTENZIONE] Ambiente virtuale non trovato! Avvio installazione automatica prima dell'accensione...
    call setup_windows.bat
)

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
echo    http://192.168.2.10:5173
echo.
echo 💻 Direttamente da questo Server Windows digita:
echo    http://localhost:5173
echo.
echo ===================================================================
echo NOTA SU ARRESTO E LOG:
echo - I servizi sono attivi in background senza finestre nere aperte.
echo - Per ARRESTARE l'applicazione in qualsiasi momento, fai doppio
echo   clic sul file: stop_windows.bat
echo - I log sono consultabili nei file: backend_app.log e frontend_app.log
echo ===================================================================
echo.
echo Questa finestra di conferma si chiudera' automaticamente tra 10 secondi...
timeout /t 10 > nul

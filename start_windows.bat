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

echo [1/2] Avvio del Backend API sulla porta 8000...
start "HiPlan - Backend API" cmd /k "cd backend && call venv\Scripts\activate.bat && uvicorn app.main:app --host 0.0.0.0 --port 8000"

echo [2/2] Avvio del Frontend Web sulla porta 5173...
start "HiPlan - Frontend Web" cmd /k "cd frontend && call npm run dev -- --host 0.0.0.0"

echo.
echo ===================================================================
echo ✅ SERVER HIPLAN AVVIATO E ACCESSIBILE DA TUTTA LA RETE!
echo.
echo 🌐 Da qualsiasi PC (Windows o Mac) in ufficio digita nel browser:
echo    http://192.168.2.10:5173
echo.
echo 💻 Direttamente da questo Server Windows digita:
echo    http://localhost:5173
echo ===================================================================
echo.
echo NOTA: Per spegnere il gestionale, chiudi le due finestre nere aperte sul desktop.
pause

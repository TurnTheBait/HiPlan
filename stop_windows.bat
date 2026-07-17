@echo off
title HiPlan - Arresto Servizi
echo ========================================================
echo          ARRESTO DEL SERVIZIO HIPLAN SU WINDOWS
echo ========================================================
echo.

echo [1/3] Ricerca e chiusura processi sulle porte 8000 e 5173...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a > nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173 ^| findstr LISTENING') do (
    taskkill /F /PID %%a > nul 2>&1
)

echo [2/3] Chiusura processi uvicorn (Backend API)...
taskkill /F /IM uvicorn.exe > nul 2>&1

echo [3/3] Verifica processi di background HiPlan rimasti...
powershell -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*app.main:app*' -or $_.CommandLine -like '*npm run dev -- --host 0.0.0.0*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" > nul 2>&1

echo.
echo ========================================================
echo ✅ TUTTI I SERVIZI HIPLAN SONO STATI ARRESTATI!
echo ========================================================
echo.
echo Questa finestra si chiudera' automaticamente tra 5 secondi...
timeout /t 5

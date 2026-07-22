@echo off
title HiPlan - Installazione Server Windows
echo ========================================================
echo   HiPlan - Installazione sul Server Windows
echo ========================================================

cd /d "%~dp0"

echo.
echo [1/3] Creazione ambiente virtuale Python (venv)...
cd backend
if not exist "venv" (
    python -m venv venv
)
call venv\Scripts\activate.bat

echo.
echo [2/3] Installazione dipendenze Python e Inizializzazione Database...
venv\Scripts\python.exe -m pip install --upgrade pip
venv\Scripts\python.exe -m pip install -r requirements.txt
venv\Scripts\python.exe seed.py

echo.
echo [3/3] Installazione dipendenze Frontend (Node.js)...
cd ..\frontend
call npm install

echo.
echo ========================================================
echo ✅ INSTALLAZIONE COMPLETATA CON SUCCESSO!
echo Ora puoi avviare il gestionale cliccando su: start_windows.bat
echo ========================================================
pause

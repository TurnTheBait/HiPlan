@echo off
setlocal EnableExtensions EnableDelayedExpansion
title HiPlan - Aggiornamento

echo Esecuzione backup di sicurezza prima dell'aggiornamento...
if exist "backend\venv\Scripts\python.exe" (
    "backend\venv\Scripts\python.exe" -c "import sys; sys.path.append('backend'); from app.services.backup_service import run_backup; run_backup()" || echo Attenzione: Backup fallito, continuo comunque l'aggiornamento.
) else (
    echo Ambiente python non trovato, salto il backup.
)
echo.

echo Aggiornamento dipendenze in corso...
call setup_windows.bat --no-pause

echo.
echo Aggiornamento completato! Ora puoi riavviare l'app con start_windows.bat
pause

@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."
title HiPlan - Aggiornamento

echo ========================================================
echo   HiPlan - Procedura di Aggiornamento
echo ========================================================

echo.
echo [1/3] Arresto dei servizi in esecuzione...
call stop_windows.bat --no-pause

echo.
echo [2/3] Esecuzione backup di sicurezza (Database)...
if exist "backend\venv\Scripts\python.exe" (
    "backend\venv\Scripts\python.exe" -c "import sys; sys.path.append('backend'); from app.services.backup_service import run_backup; run_backup()" || echo Attenzione: Backup fallito, continuo comunque.
) else (
    echo Ambiente python non trovato, salto il backup.
)

echo.
echo [3/3] Aggiornamento delle dipendenze e build...
call scripts\setup_windows.bat --no-pause
if errorlevel 1 goto error

echo.
echo ========================================================
echo   AGGIORNAMENTO COMPLETATO CON SUCCESSO!
echo ========================================================
echo I tuoi dati (Database, .env, Allegati) sono intatti.
echo Ora puoi riavviare l'applicazione usando start_windows.bat
echo.
pause
exit /b 0

:error
echo.
echo ========================================================
echo   AGGIORNAMENTO NON COMPLETATO
echo   Si e' verificato un errore durante l'aggiornamento.
echo   Controlla i messaggi sopra riportati.
echo ========================================================
echo.
pause
exit /b 1

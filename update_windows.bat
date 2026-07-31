@echo off
setlocal EnableExtensions EnableDelayedExpansion
title HiPlan - Aggiornamento

echo Aggiornamento dipendenze in corso...
call setup_windows.bat --no-pause

echo.
echo Aggiornamento completato! Ora puoi riavviare l'app con start_windows.bat
pause

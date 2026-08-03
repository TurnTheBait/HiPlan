@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title HiPlan - Crea Pacchetto Zip

where py >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_CMD=py -3"
) else (
    set "PYTHON_CMD=python"
)

%PYTHON_CMD% create_update_zip.py
pause

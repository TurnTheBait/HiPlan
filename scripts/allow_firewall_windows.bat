@echo off
setlocal EnableExtensions
title HiPlan - Sblocco Porte Firewall Windows
echo ========================================================
echo        CONFIGURAZIONE FIREWALL WINDOWS PER HIPLAN
echo ========================================================
echo.

net session >nul 2>&1
if errorlevel 1 (
    echo [ERRORE] Sono richiesti i privilegi di amministratore.
    echo Fai clic destro su questo file e scegli "Esegui come amministratore".
    echo.
    pause
    exit /b 1
)

echo [1/2] Rimozione della precedente regola HiPlan...
netsh advfirewall firewall delete rule name="HiPlan Server Ports (5173, 8000)" >nul 2>&1

echo.
echo [2/2] Apertura porte 5173 e 8000 sui profili Privato e Dominio...
netsh advfirewall firewall add rule name="HiPlan Server Ports (5173, 8000)" dir=in action=allow protocol=TCP localport=5173,8000 profile=private,domain

if errorlevel 1 (
    echo.
    echo [ERRORE] Impossibile creare la regola firewall.
    pause
    exit /b 1
) else (
    echo.
    echo ========================================================
    echo   FIREWALL CONFIGURATO
    echo   Accesso LAN: http://IP-DEL-SERVER:5173
    echo ========================================================
)
pause
exit /b 0

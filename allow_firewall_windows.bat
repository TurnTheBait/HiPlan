@echo off
title HiPlan - Sblocco Porte Firewall Windows
echo ========================================================
echo        APERTURA E SBLOCCO PORTE FIREWALL WINDOWS
echo ========================================================
echo.
echo [1/2] Rimozione di eventuali blocchi precedenti sulle porte 5173 e 8000...
netsh advfirewall firewall delete rule name="HiPlan Server Ports (5173, 8000)" >nul 2>&1
netsh advfirewall firewall delete rule name=all protocol=TCP localport=5173 >nul 2>&1
netsh advfirewall firewall delete rule name=all protocol=TCP localport=8000 >nul 2>&1

echo.
echo [2/2] Aggiunta regola di sblocco totale per le porte 5173 e 8000...
netsh advfirewall firewall add rule name="HiPlan Server Ports (5173, 8000)" dir=in action=allow protocol=TCP localport=5173,8000 profile=any edge=yes

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo =======================================================================
    echo [ERRORE] PRIVILEGI DI AMMINISTRATORE RICHIESTI!
    echo.
    echo Per favore, chiudi questa finestra, fai CLIC DESTRO su questo file:
    echo            allow_firewall_windows.bat
    echo e seleziona "ESEGUI COME AMMINISTRATORE".
    echo =======================================================================
    echo.
) else (
    echo.
    echo =======================================================================
    echo ✅ PORTE 5173 E 8000 SBLOCCATE CON SUCCESSO SU TUTTI I PROFILI!
    echo =======================================================================
    echo Ora l'applicazione e' perfettamente accessibile dal Mac e da tutti i PC
    echo della rete digitando nel browser: http://[IP_ADDRESS]
    echo.
)
pause

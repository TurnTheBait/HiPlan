@echo off
title HiPlan - Sblocco Porte Firewall
echo ========================================================
echo        APERTURA PORTE FIREWALL WINDOWS PER HIPLAN
echo ========================================================
echo.
echo Tentativo di aggiunta regola al Windows Defender Firewall...
echo.

netsh advfirewall firewall add rule name="HiPlan Server Ports (5173, 8000)" dir=in action=allow protocol=TCP localport=5173,8000

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERRORE] Privilegi di amministratore richiesti!
    echo Per favore, chiudi questa finestra, fai CLIC DESTRO su questo file
    echo "allow_firewall_windows.bat" e seleziona "ESEGUI COME AMMINISTRATORE".
    echo.
) else (
    echo.
    echo ========================================================
    echo ✅ PORTE 5173 E 8000 APERTE CON SUCCESSO NEL FIREWALL!
    echo Ora l'applicazione e' accessibile da tutti i PC della rete.
    echo ========================================================
    echo.
)
pause

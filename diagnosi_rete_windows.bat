@echo off
title HiPlan - Diagnosi Rete e Firewall Windows
echo =======================================================================
echo          DIAGNOSI E RISOLUZIONE PROBLEMI DI RETE SUL SERVER
echo =======================================================================
echo.

cd /d "%~dp0"

echo [1/4] Controllo se i servizi HiPlan sono in ascolto sulle porte 5173 e 8000...
set FRONTEND_RUNNING=0
set BACKEND_RUNNING=0

for /f "tokens=5" %%a in ('netstat -aon ^| findstr /i ":5173" ^| findstr /i "LISTENING"') do (
    set FRONTEND_RUNNING=1
    echo   [OK] Frontend attivo e in ascolto su 0.0.0.0:5173 (PID: %%a)
)
if %FRONTEND_RUNNING%==0 (
    echo   [ERRORE] Il Frontend NON e' in ascolto sulla porta 5173!
    echo            Avvia l'applicazione facendo doppio clic su "start_windows.bat".
)

for /f "tokens=5" %%a in ('netstat -aon ^| findstr /i ":8000" ^| findstr /i "LISTENING"') do (
    set BACKEND_RUNNING=1
    echo   [OK] Backend API attivo e in ascolto su 0.0.0.0:8000 (PID: %%a)
)
if %BACKEND_RUNNING%==0 (
    echo   [ERRORE] Il Backend NON e' in ascolto sulla porta 8000!
    echo            Avvia l'applicazione facendo doppio clic su "start_windows.bat".
)

echo.
echo [2/4] Controllo e configurazione Profilo Rete (Privata vs Pubblica)...
echo       Se la rete e' "Pubblica", Windows blocca spesso l'accesso esterno persino con le porte aperte.
powershell -Command "Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -ne 'Private' } | ForEach-Object { echo '   [ATTENZIONE] Rete pubblica rilevata (' $_.Name '). Conversione in Privata in corso...'; Set-NetConnectionProfile -Name $_.Name -NetworkCategory Private -ErrorAction SilentlyContinue }"
echo   [OK] Profilo di rete verificato/impostato su PRIVATA.

echo.
echo [3/4] Verifica regole Firewall di Windows sulle porte 5173 e 8000...
netsh advfirewall firewall delete rule name="HiPlan Server Ports (5173, 8000)" >nul 2>&1
netsh advfirewall firewall add rule name="HiPlan Server Ports (5173, 8000)" dir=in action=allow protocol=TCP localport=5173,8000 profile=any edge=yes >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo   [OK] Regole Firewall di Windows aggiornate con successo.
) else (
    echo   [ATTENZIONE] Per aggiornare le regole del Firewall apri questo script come AMMINISTRATORE.
)

echo.
echo [4/4] Controllo presenza Antivirus/Firewall di terze parti...
powershell -Command "Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntivirusProduct -ErrorAction SilentlyContinue | Where-Object { $_.displayName -notlike '*Windows Defender*' } | ForEach-Object { echo ('   [ALLERTA] Rilevato Antivirus/Security di terze parti: ' + $_.displayName) }"

echo.
echo =======================================================================
echo                          RIEPILOGO E CONSIGLI
echo =======================================================================
echo Se il ping dal Mac funziona ma la pagina non si apre ancora:
echo.
echo 1) Assicurati che "Frontend in ascolto" sopra indichi [OK]. Se e' [ERRORE],
echo    esegui "start_windows.bat".
echo 2) Se sopra e' comparsa la scritta [ALLERTA] con un Antivirus esterno
echo    (es. McAfee, Norton, Kaspersky, Avast, ESET, Bitdefender),
echo    quel programma ha un SUO FIREWALL INTERNO indipendente da Windows!
echo    Devi aprire le porte TCP 5173 e 8000 dentro le impostazioni di
echo    quell'Antivirus.
echo 3) Se il tuo Mac e il Server Windows sono connessi via Wi-Fi su un router
echo    con "Isolamento Client" (AP Isolation / Rete Ospiti), il router impedisce
echo    ai computer di scambiarsi dati sul web.
echo =======================================================================
echo.
pause

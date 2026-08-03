#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."

echo "Esecuzione backup di sicurezza prima dell'aggiornamento..."
if [ -f "backend/venv/bin/python" ]; then
    backend/venv/bin/python -c "import sys; sys.path.append('backend'); from app.services.backup_service import run_backup; run_backup()" || echo "Attenzione: Backup fallito, continuo comunque l'aggiornamento."
else
    echo "Ambiente python non trovato, salto il backup."
fi
echo ""

echo "Aggiornamento dipendenze in corso..."
bash setup_mac.sh

echo ""
echo "Aggiornamento completato! Ora puoi riavviare l'app con start_mac_server.sh"

#!/usr/bin/env bash
set -e

echo "Aggiornamento dipendenze in corso..."
bash setup_mac.sh

echo ""
echo "Aggiornamento completato! Ora puoi riavviare l'app con start_mac_server.sh"

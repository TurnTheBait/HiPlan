#!/bin/bash

# Spostati nella cartella del progetto
cd "$(dirname "$0")" || exit

# Rileva automaticamente l'indirizzo IP locale del Mac (Wi-Fi o Ethernet)
MAC_IP=$(ipconfig getifaddr en0 2>/dev/null)
if [ -z "$MAC_IP" ]; then
    MAC_IP=$(ipconfig getifaddr en1 2>/dev/null)
fi
if [ -z "$MAC_IP" ]; then
    MAC_IP=$(ipconfig getifaddr en2 2>/dev/null)
fi
if [ -z "$MAC_IP" ]; then
    MAC_IP="IP_NON_TROVATO"
fi

echo "=================================================================="
echo "    🚀 AVVIO DI HIPLAN CON IL TUO MAC COME SERVER AZIENDALE"
echo "=================================================================="
echo "📡 IP rilevato di questo Mac: $MAC_IP"
echo ""

echo "Avvio Backend API (porta 8000 in ascolto su tutta la LAN)..."
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

echo "Avvio Frontend Web (porta 5173 in ascolto su tutta la LAN)..."
cd ../frontend
npm run dev -- --host 0.0.0.0 &
FRONTEND_PID=$!

echo "⏳ Inizializzazione server..."
sleep 3
open "http://localhost:5173"

echo ""
echo "=================================================================="
echo "✅ SERVER ATTIVO! ORA TUTTI IN UFFICIO POSSONO COLLEGARSENI:"
echo ""
echo "💻 Direttamente da questo Mac:"
echo "   👉 http://localhost:5173"
echo ""
if [ "$MAC_IP" != "IP_NON_TROVATO" ]; then
    echo "🌐 Da TUTTI I PC Windows o Mac dell'ufficio (nella stessa rete):"
    echo "   👉 http://${MAC_IP}:5173"
else
    echo "🌐 Da TUTTI I PC Windows o Mac dell'ufficio:"
    echo "   👉 http://<INSERISCI_IP_DEL_MAC>:5173 (Controlla il tuo IP in Impostazioni Rete)"
fi
echo "=================================================================="
echo "Premere CTRL+C in questo terminale per arrestare il server."

trap "echo '🛑 Chiusura dei server in corso...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
wait

#!/bin/bash

# Spostati nella cartella in cui si trova questo script
cd "$(dirname "$0")" || exit

# Rileva automaticamente l'IP locale del Mac (Wi-Fi o Ethernet)
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

echo "🚀 Avvio del Backend in corso..."
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

echo "🚀 Avvio del Frontend in corso..."
cd ../frontend
npm run dev -- --host 0.0.0.0 &
FRONTEND_PID=$!

echo "🌐 Apertura nel browser locale..."
sleep 3
open "http://localhost:5173"

echo ""
echo "=================================================================="
echo "✅ Applicazione in esecuzione!"
echo "💻 Su questo Mac:    http://localhost:5173"
if [ "$MAC_IP" != "IP_NON_TROVATO" ]; then
    echo "🌐 Da altri PC/Mac:  http://${MAC_IP}:5173"
else
    echo "🌐 Da altri PC/Mac:  http://<IP_DI_QUESTO_MAC>:5173"
fi
echo "=================================================================="
echo "Premere CTRL+C in questo terminale per spegnere tutto."

trap "echo '🛑 Terminazione dei server...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
wait

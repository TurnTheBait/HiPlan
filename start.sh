#!/bin/bash

# Spostati nella cartella in cui si trova questo script (utile se avviato con doppio clic)
cd "$(dirname "$0")" || exit

echo "🚀 Avvio del Backend in corso..."
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --port 8000 &
BACKEND_PID=$!

echo "🚀 Avvio del Frontend in corso..."
cd ../frontend
npm run dev &
FRONTEND_PID=$!

echo "🌐 Apertura nel browser..."
# Attendiamo che i server si inizializzino
sleep 3
open "http://localhost:5173"

echo "✅ Applicazione in esecuzione!"
echo "Premere CTRL+C in questo terminale per spegnere tutto."

# Trap per terminare i processi figlio quando lo script viene interrotto
trap "echo '🛑 Terminazione dei server...'; kill $BACKEND_PID $FRONTEND_PID; exit" SIGINT SIGTERM

# Attende indefinitamente
wait

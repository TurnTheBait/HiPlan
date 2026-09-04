#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
LOG_DIR="$ROOT_DIR/logs"
BACKEND_PID=""
FRONTEND_PID=""

# Evita che la variabile generica DEBUG della shell sovrascriva backend/.env.
unset DEBUG

local_ip() {
  local interface_name=""
  interface_name="$(route get default 2>/dev/null | awk '/interface:/{print $2; exit}')" || true
  if [[ -n "$interface_name" ]]; then
    ipconfig getifaddr "$interface_name" 2>/dev/null || true
  fi
}

port_is_busy() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

cleanup() {
  trap - EXIT INT TERM
  echo
  echo "[STOP] Arresto dei servizi HiPlan..."
  [[ -n "$FRONTEND_PID" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  [[ -n "$BACKEND_PID" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  
  # Forza la chiusura di eventuali processi orfani (es. vite o node) rimasti appesi sulle porte
  lsof -ti:8000 | xargs kill -9 2>/dev/null || true
  lsof -ti:5173 | xargs kill -9 2>/dev/null || true
  
  [[ -n "$FRONTEND_PID" ]] && wait "$FRONTEND_PID" 2>/dev/null || true
  [[ -n "$BACKEND_PID" ]] && wait "$BACKEND_PID" 2>/dev/null || true
}

cd "$ROOT_DIR"

if [[ ! -x "$BACKEND_DIR/venv/bin/python" || ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "[INFO] Installazione incompleta: avvio della configurazione iniziale."
  bash "$ROOT_DIR/setup_mac.sh"
fi

if port_is_busy 8000 || port_is_busy 5173; then
  echo "[ERRORE] Le porte 8000 o 5173 sono gia' occupate."
  echo "Arresta la precedente istanza di HiPlan e riprova."
  exit 1
fi

mkdir -p "$LOG_DIR"
trap cleanup EXIT INT TERM

echo "[1/2] Avvio backend API in background..."
(
  cd "$BACKEND_DIR"
  exec "$BACKEND_DIR/venv/bin/python" -m uvicorn app.main:app \
    --host 0.0.0.0 --port 8000 --log-level info
) >"$LOG_DIR/backend_app.log" 2>&1 &
BACKEND_PID=$!

echo "[2/2] Avvio frontend in background..."
(
  cd "$FRONTEND_DIR"
  exec npm --silent run dev -- --host 0.0.0.0 --port 5173 --strictPort --logLevel error
) >"$LOG_DIR/frontend_app.log" 2>&1 &
FRONTEND_PID=$!

READY=0
for _ in {1..30}; do
  if curl -fsS "http://localhost:8000/api/health" >/dev/null 2>&1 &&
     curl -fsS "http://localhost:5173" >/dev/null 2>&1; then
    READY=1
    break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null || ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [[ "$READY" -ne 1 ]]; then
  echo "[ERRORE] I servizi non sono diventati disponibili."
  echo "Controlla $LOG_DIR/backend_app.log e $LOG_DIR/frontend_app.log."
  exit 1
fi

MAC_IP="$(local_ip)"
open "http://localhost:5173"

echo
echo "=================================================================="
echo "  Server HiPlan attivo"
echo "  Questo Mac: http://localhost:5173"
if [[ -n "$MAC_IP" ]]; then
  echo "  Rete aziendale: http://${MAC_IP}:5173"
else
  echo "  Rete aziendale: http://<IP-DEL-MAC>:5173"
fi
echo "  Log backend:  $LOG_DIR/backend_app.log"
echo "  Log frontend: $LOG_DIR/frontend_app.log"
echo "  Premi CTRL+C per arrestare i servizi."
echo "=================================================================="

wait "$BACKEND_PID" "$FRONTEND_PID"

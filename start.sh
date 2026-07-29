#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
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

trap cleanup EXIT INT TERM

echo "[1/2] Avvio backend API su http://localhost:8000 ..."
(
  cd "$BACKEND_DIR"
  exec "$BACKEND_DIR/venv/bin/python" -m uvicorn app.main:app \
    --reload --host 0.0.0.0 --port 8000
) &
BACKEND_PID=$!

echo "[2/2] Avvio frontend su http://localhost:5173 ..."
(
  cd "$FRONTEND_DIR"
  exec npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
) &
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
  exit 1
fi

MAC_IP="$(local_ip)"
open "http://localhost:5173"

echo
echo "=================================================================="
echo "  HiPlan avviato"
echo "  Questo Mac: http://localhost:5173"
if [[ -n "$MAC_IP" ]]; then
  echo "  Rete locale: http://${MAC_IP}:5173"
else
  echo "  Rete locale: http://<IP-DEL-MAC>:5173"
fi
echo "  Premi CTRL+C per arrestare backend e frontend."
echo "=================================================================="

wait "$BACKEND_PID" "$FRONTEND_PID"

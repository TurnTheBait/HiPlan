#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
LOG_DIR="$ROOT_DIR/logs"
BACKEND_PID=""
FRONTEND_PID=""

# Colori ANSI
C_RESET=$'\033[0m'
C_BOLD=$'\033[1m'
C_DIM=$'\033[2m'
C_RED=$'\033[91m'
C_GREEN=$'\033[92m'
C_YELLOW=$'\033[93m'
C_BLUE=$'\033[94m'
C_CYAN=$'\033[96m'
C_WHITE=$'\033[97m'
C_GRAY=$'\033[90m'

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
  echo
  echo "${C_BLUE}╔══════════════════════════════════════════════════════════════════╗${C_RESET}"
  echo "${C_BLUE}║${C_BOLD}${C_WHITE}                  H I P L A N  -  A R R E S T O                   ${C_RESET}${C_BLUE}║${C_RESET}"
  echo "${C_BLUE}║${C_GRAY}                Chiusura Servizi e Processi Attivi                ${C_RESET}${C_BLUE}║${C_RESET}"
  echo "${C_BLUE}╚══════════════════════════════════════════════════════════════════╝${C_RESET}"
  echo
  echo "${C_CYAN}[1/2]${C_RESET} Chiusura Backend API..."
  [[ -n "$BACKEND_PID" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  lsof -ti:8000 | xargs kill -9 2>/dev/null || true
  [[ -n "$BACKEND_PID" ]] && wait "$BACKEND_PID" 2>/dev/null || true
  echo "      ${C_GREEN}[✔]${C_RESET} Backend API terminato."

  echo "${C_CYAN}[2/2]${C_RESET} Chiusura Frontend Web..."
  [[ -n "$FRONTEND_PID" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  lsof -ti:5173 | xargs kill -9 2>/dev/null || true
  [[ -n "$FRONTEND_PID" ]] && wait "$FRONTEND_PID" 2>/dev/null || true
  echo "      ${C_GREEN}[✔]${C_RESET} Frontend Web terminato."

  echo
  echo "${C_GREEN}╔══════════════════════════════════════════════════════════════════╗${C_RESET}"
  echo "${C_GREEN}║${C_BOLD}${C_WHITE}              SERVIZI HIPLAN ARRESTATI CON SUCCESSO               ${C_RESET}${C_GREEN}║${C_RESET}"
  echo "${C_GREEN}╚══════════════════════════════════════════════════════════════════╝${C_RESET}"
  echo
}

cd "$ROOT_DIR"

echo
echo "${C_CYAN}╔══════════════════════════════════════════════════════════════════╗${C_RESET}"
echo "${C_CYAN}║${C_BOLD}${C_WHITE}                    H I P L A N  -  A V V I O                     ${C_RESET}${C_CYAN}║${C_RESET}"
echo "${C_CYAN}║${C_GRAY}            Pianificazione Commesse & Gestione Risorse            ${C_RESET}${C_CYAN}║${C_RESET}"
echo "${C_CYAN}╚══════════════════════════════════════════════════════════════════╝${C_RESET}"
echo

if [[ ! -x "$BACKEND_DIR/venv/bin/python" || ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "${C_YELLOW}[i] Installazione incompleta rilevata: avvio configurazione iniziale...${C_RESET}"
  echo
  bash "$ROOT_DIR/scripts/setup_mac.sh"
fi

echo "${C_CYAN}[i]${C_RESET} Verifica disponibilita' porte di rete..."
if port_is_busy 8000; then
  echo "${C_RED}[✖] ERRORE: La porta 8000 (Backend API) e' gia' occupata.${C_RESET}"
  echo "${C_YELLOW}    Esegui './stop_mac_server.sh' per terminare le istanze attive.${C_RESET}"
  exit 1
fi
if port_is_busy 5173; then
  echo "${C_RED}[✖] ERRORE: La porta 5173 (Frontend Web) e' gia' occupata.${C_RESET}"
  echo "${C_YELLOW}    Esegui './stop_mac_server.sh' per terminare le istanze attive.${C_RESET}"
  exit 1
fi
echo "${C_GREEN}[✔]${C_RESET} Porte 8000 e 5173 libere."

mkdir -p "$LOG_DIR"
trap cleanup EXIT INT TERM

echo
echo "${C_BOLD}─── Avvio Servizi in Background ──────────────────────────────────${C_RESET}"
echo "${C_CYAN}[1/2]${C_RESET} Avvio backend API FastAPI (porta 8000)..."
(
  cd "$BACKEND_DIR"
  exec "$BACKEND_DIR/venv/bin/python" -m uvicorn app.main:app \
    --host 0.0.0.0 --port 8000 --log-level info
) >"$LOG_DIR/backend_app.log" 2>&1 &
BACKEND_PID=$!

echo "${C_CYAN}[2/2]${C_RESET} Avvio frontend Web Vite (porta 5173)..."
(
  cd "$FRONTEND_DIR"
  exec npm --silent run dev -- --host 0.0.0.0 --port 5173 --strictPort --logLevel error
) >"$LOG_DIR/frontend_app.log" 2>&1 &
FRONTEND_PID=$!

echo
echo "${C_CYAN}[i]${C_RESET} Attesa disponibilita' dei servizi..."
READY=0
for _ in {1..45}; do
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
  echo
  echo "${C_RED}[✖] ERRORE: I servizi non rispondono entro il tempo previsto.${C_RESET}"
  echo "${C_YELLOW}    Controlla i log per maggiori dettagli:${C_RESET}"
  echo "      • $LOG_DIR/backend_app.log"
  echo "      • $LOG_DIR/frontend_app.log"
  exit 1
fi

MAC_IP="$(local_ip)"
open "http://localhost:5173" 2>/dev/null || true

echo
echo "${C_GREEN}╔══════════════════════════════════════════════════════════════════╗${C_RESET}"
echo "${C_GREEN}║${C_BOLD}${C_WHITE}                   HIPLAN AVVIATO CON SUCCESSO                    ${C_RESET}${C_GREEN}║${C_RESET}"
echo "${C_GREEN}╚══════════════════════════════════════════════════════════════════╝${C_RESET}"
echo
echo "${C_BOLD}  Indirizzi di accesso:${C_RESET}"
echo "    ${C_GREEN}➜${C_RESET}  Questo Mac:    ${C_CYAN}${C_BOLD}http://localhost:5173${C_RESET}"
if [[ -n "$MAC_IP" ]]; then
  echo "    ${C_GREEN}➜${C_RESET}  Rete locale:   ${C_CYAN}${C_BOLD}http://${MAC_IP}:5173${C_RESET}"
else
  echo "    ${C_GREEN}➜${C_RESET}  Rete locale:   ${C_CYAN}${C_BOLD}http://IP-DEL-MAC:5173${C_RESET}"
fi
echo "    ${C_GREEN}➜${C_RESET}  API Docs:      ${C_GRAY}http://localhost:8000/docs${C_RESET}"
echo
echo "${C_BOLD}  Gestione e Log:${C_RESET}"
echo "    ${C_GRAY}•  Per arrestare:  Premi CTRL+C oppure usa ./stop_mac_server.sh${C_RESET}"
echo "    ${C_GRAY}•  Log backend:    logs/backend_app.log${C_RESET}"
echo "    ${C_GRAY}•  Log frontend:   logs/frontend_app.log${C_RESET}"
echo

wait "$BACKEND_PID" "$FRONTEND_PID"

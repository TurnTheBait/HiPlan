#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
LOG_DIR="$ROOT_DIR/logs"
BACKEND_PID=""
FRONTEND_PID=""

# Colori e Stili ANSI
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

CURRENT_PCT=0

draw_bar() {
  local pct="$1"
  local text="$2"
  local w=18
  local fill=$(( pct * w / 100 ))
  local empty=$(( w - fill ))
  local f_str=""
  local e_str=""
  for ((i=0; i<fill; i++)); do f_str+="█"; done
  for ((i=0; i<empty; i++)); do e_str+="░"; done
  
  printf "\r\033[2K  ${C_GRAY}[${C_CYAN}%s${C_GRAY}%s]${C_RESET} ${C_BOLD}${C_WHITE}%3d%%${C_RESET}  ${C_WHITE}%s${C_RESET}" \
    "$f_str" "$e_str" "$pct" "$text"
}

advance_bar() {
  local target="$1"
  local text="$2"
  local step="${3:-5}"
  local delay="${4:-0.015}"
  while [ "$CURRENT_PCT" -lt "$target" ]; do
    CURRENT_PCT=$(( CURRENT_PCT + step ))
    [ "$CURRENT_PCT" -gt "$target" ] && CURRENT_PCT="$target"
    draw_bar "$CURRENT_PCT" "$text"
    sleep "$delay"
  done
}

finish_bar() {
  local text="$1"
  local w=18
  local f_str=""
  for ((i=0; i<w; i++)); do f_str+="█"; done
  printf "\r\033[2K  ${C_GRAY}[${C_GREEN}%s${C_GRAY}]${C_RESET} ${C_BOLD}${C_GREEN}100%%${C_RESET}  ${C_BOLD}${C_GREEN}✔ %s${C_RESET}\n\n" \
    "$f_str" "$text"
}

fail_bar() {
  local text="$1"
  local w=18
  local fill=$(( CURRENT_PCT * w / 100 ))
  local empty=$(( w - fill ))
  local f_str=""
  local e_str=""
  for ((i=0; i<fill; i++)); do f_str+="█"; done
  for ((i=0; i<empty; i++)); do e_str+="░"; done
  printf "\r\033[2K  ${C_GRAY}[${C_RED}%s${C_GRAY}%s]${C_RESET} ${C_BOLD}${C_RED}%3d%%${C_RESET}  ${C_BOLD}${C_RED}✖ %s${C_RESET}\n\n" \
    "$f_str" "$e_str" "$CURRENT_PCT" "$text"
}

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
  echo "${C_BLUE}╭──────────────────────────────────────────────────────────────────╮${C_RESET}"
  echo "${C_BLUE}│${C_RESET}  ${C_BOLD}${C_WHITE}■  H I P L A N  ·  A R R E S T O  S E R V I Z I                 ${C_RESET}${C_BLUE}│${C_RESET}"
  echo "${C_BLUE}│${C_RESET}     ${C_GRAY}Chiusura Servizi e Processi Attivi                           ${C_RESET}${C_BLUE}│${C_RESET}"
  echo "${C_BLUE}╰──────────────────────────────────────────────────────────────────╯${C_RESET}"
  echo
  
  CURRENT_PCT=0
  advance_bar 40 "Chiusura Backend API (8000)..."
  [[ -n "$BACKEND_PID" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  lsof -ti:8000 2>/dev/null | xargs kill -9 2>/dev/null || true
  [[ -n "$BACKEND_PID" ]] && wait "$BACKEND_PID" 2>/dev/null || true

  advance_bar 80 "Chiusura Frontend Web (5173)..."
  [[ -n "$FRONTEND_PID" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  lsof -ti:5173 2>/dev/null | xargs kill -9 2>/dev/null || true
  [[ -n "$FRONTEND_PID" ]] && wait "$FRONTEND_PID" 2>/dev/null || true

  pkill -9 -f "uvicorn app.main:app" 2>/dev/null || true
  pkill -9 -f "vite.*5173" 2>/dev/null || true

  advance_bar 100 "Processi arrestati"
  finish_bar "Servizi HiPlan arrestati con successo"
}

cd "$ROOT_DIR"

echo
echo "${C_CYAN}╭──────────────────────────────────────────────────────────────────╮${C_RESET}"
echo "${C_CYAN}│${C_RESET}  ${C_BOLD}${C_WHITE}◆  H I P L A N  ·  A V V I O  S E R V E R                       ${C_RESET}${C_CYAN}│${C_RESET}"
echo "${C_CYAN}│${C_RESET}     ${C_GRAY}Pianificazione Commesse & Gestione Risorse                   ${C_RESET}${C_CYAN}│${C_RESET}"
echo "${C_CYAN}╰──────────────────────────────────────────────────────────────────╯${C_RESET}"
echo

if [[ ! -x "$BACKEND_DIR/venv/bin/python" || ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "  ${C_YELLOW}[!] Installazione incompleta rilevata: avvio configurazione...${C_RESET}"
  echo
  bash "$ROOT_DIR/scripts/setup_mac.sh"
fi

advance_bar 15 "Verifica porte 8000 e 5173..."
if port_is_busy 8000 || port_is_busy 5173; then
  advance_bar 20 "Pulizia porte occupate..."
  lsof -ti:8000 2>/dev/null | xargs kill -9 2>/dev/null || true
  lsof -ti:5173 2>/dev/null | xargs kill -9 2>/dev/null || true
  sleep 1
  if port_is_busy 8000; then
    fail_bar "Porta 8000 occupata da un'altra applicazione"
    exit 1
  fi
  if port_is_busy 5173; then
    fail_bar "Porta 5173 occupata da un'altra applicazione"
    exit 1
  fi
fi
advance_bar 25 "Porte di rete libere e pronte"

mkdir -p "$LOG_DIR"
trap cleanup EXIT INT TERM

advance_bar 35 "Avvio Backend FastAPI (8000)..."
(
  cd "$BACKEND_DIR"
  exec "$BACKEND_DIR/venv/bin/python" -m uvicorn app.main:app \
    --host 0.0.0.0 --port 8000 --log-level info
) >"$LOG_DIR/backend_app.log" 2>&1 &
BACKEND_PID=$!
advance_bar 50 "Backend API FastAPI attivo"

advance_bar 60 "Avvio Frontend Vite (5173)..."
(
  cd "$FRONTEND_DIR"
  exec npm run dev -- --host 0.0.0.0 --port 5173
) >"$LOG_DIR/frontend_app.log" 2>&1 &
FRONTEND_PID=$!
advance_bar 70 "Frontend Web Vite attivo"

READY=0
for ((attempt=1; attempt<=45; attempt++)); do
  target=$(( 70 + (attempt * 25 / 45) ))
  advance_bar "$target" "Verifica risposta HTTP (${attempt}s)..." 1 0.005

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
  fail_bar "I servizi non rispondono entro il tempo previsto"
  echo "  ${C_YELLOW}Consulta i log per maggiori informazioni:${C_RESET}"
  echo "    • $LOG_DIR/backend_app.log"
  echo "    • $LOG_DIR/frontend_app.log"
  exit 1
fi

advance_bar 100 "Tutti i servizi online!" 3 0.01
finish_bar "HiPlan avviato e sincronizzato con successo!"

MAC_IP="$(local_ip)"
open "http://localhost:5173" 2>/dev/null || true

echo "${C_GREEN}╭──────────────────────────────────────────────────────────────────╮${C_RESET}"
echo "${C_GREEN}│${C_RESET}  ${C_BOLD}${C_WHITE}✔  HIPLAN AVVIATO CON SUCCESSO                                  ${C_RESET}${C_GREEN}│${C_RESET}"
echo "${C_GREEN}╰──────────────────────────────────────────────────────────────────╯${C_RESET}"
echo
echo "  ${C_BOLD}Indirizzi di Accesso:${C_RESET}"
echo "    ${C_GREEN}●${C_RESET}  Questo Mac:     ${C_CYAN}${C_BOLD}http://localhost:5173${C_RESET}"
if [[ -n "$MAC_IP" ]]; then
  echo "    ${C_GREEN}●${C_RESET}  Rete Locale:    ${C_CYAN}${C_BOLD}http://${MAC_IP}:5173${C_RESET}"
else
  echo "    ${C_GREEN}●${C_RESET}  Rete Locale:    ${C_CYAN}${C_BOLD}http://IP-DEL-MAC:5173${C_RESET}"
fi
echo "    ${C_GREEN}●${C_RESET}  Documentazione: ${C_GRAY}http://localhost:8000/docs${C_RESET}"
echo
echo "  ${C_BOLD}Gestione Operativa:${C_RESET}"
echo "    ${C_GRAY}·  Arresto rapido:  ./stop_mac_server.sh (o premi CTRL+C)${C_RESET}"
echo "    ${C_GRAY}·  Log Backend:     logs/backend_app.log${C_RESET}"
echo "    ${C_GRAY}·  Log Frontend:    logs/frontend_app.log${C_RESET}"
echo

wait "$BACKEND_PID" "$FRONTEND_PID"

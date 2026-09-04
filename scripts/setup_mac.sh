#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
LOG_DIR="$ROOT_DIR/logs"
SETUP_LOG="$LOG_DIR/setup.log"
TEMP_LOG="$LOG_DIR/setup_temp.log"

mkdir -p "$LOG_DIR"
rm -f "$TEMP_LOG"

RUN_SEED=0

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

# Barre di caricamento grafiche
BAR_33="[██████████░░░░░░░░░░░░░░░░░░░░]  33%"
BAR_66="[████████████████████░░░░░░░░░░]  66%"
BAR_100="[██████████████████████████████] 100%"

# Evita che la variabile generica DEBUG della shell sovrascriva backend/.env.
unset DEBUG

report_error() {
  local step_name="$1"
  local cmd_name="$2"
  echo
  echo "${C_RED}╔══════════════════════════════════════════════════════════════════╗${C_RESET}"
  echo "${C_RED}║${C_BOLD}${C_WHITE}                   ERRORE DURANTE L'ESECUZIONE                    ${C_RESET}${C_RED}║${C_RESET}"
  echo "${C_RED}╚══════════════════════════════════════════════════════════════════╝${C_RESET}"
  echo
  echo "  ${C_BOLD}Fase fallita:${C_RESET} ${C_YELLOW}${step_name}${C_RESET}"
  echo "  ${C_BOLD}Comando:${C_RESET}      ${C_GRAY}${cmd_name}${C_RESET}"
  echo
  echo "  ${C_BOLD}Ultime righe del log di errore:${C_RESET}"
  echo "${C_RED}────────────────────────────────────────────────────────────────────${C_RESET}"
  if [[ -f "$TEMP_LOG" && -s "$TEMP_LOG" ]]; then
    tail -n 18 "$TEMP_LOG" | sed 's/^/    /'
    cat "$TEMP_LOG" >> "$SETUP_LOG"
  else
    echo "    Nessun dettaglio aggiuntivo catturato nel file temporaneo."
  fi
  echo "${C_RED}────────────────────────────────────────────────────────────────────${C_RESET}"
  echo
  echo "  ${C_BOLD}Log completo disponibile in:${C_RESET} ${C_CYAN}${SETUP_LOG}${C_RESET}"
  echo
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --seed)
      RUN_SEED=1
      shift
      ;;
    *)
      echo "${C_RED}[✖] ERRORE: Opzione non riconosciuta: $1${C_RESET}"
      echo "${C_GRAY}Uso: ./setup_mac.sh [--seed]${C_RESET}"
      exit 2
      ;;
  esac
done

echo
echo "${C_CYAN}╔══════════════════════════════════════════════════════════════════╗${C_RESET}"
echo "${C_CYAN}║${C_BOLD}${C_WHITE}                    H I P L A N  -  S E T U P                     ${C_RESET}${C_CYAN}║${C_RESET}"
echo "${C_CYAN}║${C_GRAY}          Installazione Iniziale & Preparazione Ambiente          ${C_RESET}${C_CYAN}║${C_RESET}"
echo "${C_CYAN}╚══════════════════════════════════════════════════════════════════╝${C_RESET}"
echo

echo "${C_BOLD}─── Verifica Prerequisiti di Sistema ─────────────────────────────${C_RESET}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 non trovato nel PATH del sistema." > "$TEMP_LOG"
  report_error "Verifica Python" "which python3"
fi

if ! python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' > "$TEMP_LOG" 2>&1; then
  report_error "Versione Python non compatibile (richiesto >= 3.10)" "python3 --version"
fi
echo "${C_GREEN}[✔]${C_RESET} $(python3 --version) trovato."

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js o npm non trovati nel sistema." > "$TEMP_LOG"
  report_error "Verifica Node.js / npm" "which node && which npm"
fi

NODE_VERSION="$(node --version 2>/dev/null | tr -d 'v')"
NODE_MAJOR="$(echo "$NODE_VERSION" | cut -d. -f1)"
NODE_MINOR="$(echo "$NODE_VERSION" | cut -d. -f2)"

if (( NODE_MAJOR < 20 )); then
  echo "Versione Node.js $NODE_VERSION non supportata (richiesto 20.x LTS)." > "$TEMP_LOG"
  report_error "Versione Node.js obsoleta" "node --version"
elif (( NODE_MAJOR == 20 && NODE_MINOR < 19 )); then
  echo "${C_YELLOW}[!] Node.js $(node --version) rilevato. Si consiglia l'aggiornamento a v20.19.0+ LTS.${C_RESET}"
else
  echo "${C_GREEN}[✔]${C_RESET} Node.js $(node --version) trovato."
fi
echo "${C_GREEN}[✔]${C_RESET} npm $(npm --version) disponibile."

if [[ ! -f "$BACKEND_DIR/.env" ]]; then
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env" || report_error "Creazione .env" "cp .env.example .env"
  echo "${C_GREEN}[✔]${C_RESET} File di configurazione backend/.env generato da .env.example."
else
  echo "${C_GREEN}[✔]${C_RESET} File di configurazione backend/.env presente."
fi

echo
echo "${C_BOLD}─── [ 1/3 ] Preparazione Ambiente Python ──────────────────────────${C_RESET}"
echo "        ${C_CYAN}${BAR_33}${C_RESET}  ${C_GRAY}Configurazione venv e installazione pip...${C_RESET}"

if [[ ! -x "$BACKEND_DIR/venv/bin/python" ]]; then
  python3 -m venv "$BACKEND_DIR/venv" > "$TEMP_LOG" 2>&1 || report_error "Creazione virtualenv backend/venv" "python3 -m venv backend/venv"
fi

"$BACKEND_DIR/venv/bin/python" -m pip install --quiet --upgrade pip setuptools wheel > "$TEMP_LOG" 2>&1 || report_error "Aggiornamento pip e wheel" "pip install --upgrade pip"
"$BACKEND_DIR/venv/bin/python" -m pip install --quiet -r "$BACKEND_DIR/requirements.txt" > "$TEMP_LOG" 2>&1 || report_error "Installazione requirements.txt" "pip install -r backend/requirements.txt"
echo "        ${C_GREEN}[✔] Ambiente Python configurato con successo.${C_RESET}"

echo
echo "${C_BOLD}─── [ 2/3 ] Installazione Dipendenze Frontend ──────────────────────${C_RESET}"
echo "        ${C_CYAN}${BAR_66}${C_RESET}  ${C_GRAY}Installazione pacchetti npm (npm ci)...${C_RESET}"
(
  cd "$FRONTEND_DIR"
  npm ci --prefer-offline --no-audit --no-fund
) > "$TEMP_LOG" 2>&1 || report_error "Installazione dipendenze frontend" "cd frontend && npm ci"
echo "        ${C_GREEN}[✔] Dipendenze frontend installate con successo.${C_RESET}"

echo
echo "${C_BOLD}─── [ 3/3 ] Verifica e Compilazione ────────────────────────────────${C_RESET}"
echo "        ${C_CYAN}${BAR_100}${C_RESET}  ${C_GRAY}Verifica import FastAPI e build Vite...${C_RESET}"

(
  cd "$BACKEND_DIR"
  "$BACKEND_DIR/venv/bin/python" -c "import app.main"
) > "$TEMP_LOG" 2>&1 || report_error "Verifica modulo backend FastAPI" "python -c 'import app.main'"

(
  cd "$FRONTEND_DIR"
  npm run build
) > "$TEMP_LOG" 2>&1 || report_error "Compilazione frontend (npm run build)" "npm run build"
echo "        ${C_GREEN}[✔] Moduli verificati e frontend compilato.${C_RESET}"

if [[ "$RUN_SEED" -eq 1 ]]; then
  echo
  echo "${C_BOLD}─── [EXTRA] Inserimento Dati Dimostrativi ─────────────────────────────${C_RESET}"
  (
    cd "$BACKEND_DIR"
    "$BACKEND_DIR/venv/bin/python" seed.py
  ) > "$TEMP_LOG" 2>&1 || report_error "Popolamento dati dimostrativi seed.py" "python seed.py"
  echo "        ${C_GREEN}[✔] Dati dimostrativi inseriti con successo.${C_RESET}"
fi

if [[ -f "$TEMP_LOG" ]]; then
  cat "$TEMP_LOG" >> "$SETUP_LOG" 2>/dev/null || true
  rm -f "$TEMP_LOG"
fi

echo
echo "${C_GREEN}╔══════════════════════════════════════════════════════════════════╗${C_RESET}"
echo "${C_GREEN}║${C_BOLD}${C_WHITE}              CONFIGURAZIONE COMPLETATA CON SUCCESSO              ${C_RESET}${C_GREEN}║${C_RESET}"
echo "${C_GREEN}╚══════════════════════════════════════════════════════════════════╝${C_RESET}"
echo
echo "${C_BOLD}  Prossimi passi:${C_RESET}"
echo "    ${C_GREEN}➜${C_RESET}  Avvia il server eseguendo:"
echo "       ${C_CYAN}${C_BOLD}./start_mac_server.sh${C_RESET}"
echo
echo "    ${C_GRAY}•  File impostazioni e variabili d'ambiente: backend/.env${C_RESET}"
echo "    ${C_GRAY}•  Log di setup salvato in: logs/setup.log${C_RESET}"
echo

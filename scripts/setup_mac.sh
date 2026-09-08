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

# Barra di caricamento moderna e dinamica
render_progress() {
  local pct="$1"
  local state="$2" # run | done | error
  local text="$3"
  local w=22
  local fill=$(( pct * w / 100 ))
  local empty=$(( w - fill ))
  
  local f_str=""
  local e_str=""
  for ((i=0; i<fill; i++)); do f_str+="█"; done
  for ((i=0; i<empty; i++)); do e_str+="░"; done
  
  if [ "$state" = "done" ]; then
    printf "\r  ${C_GREEN}[✔]${C_RESET} ${C_GRAY}[${C_GREEN}%s${C_GRAY}%s]${C_RESET} ${C_BOLD}${C_WHITE}%3d%%${C_RESET}  %s\033[K\n" "$f_str" "$e_str" "$pct" "$text"
  elif [ "$state" = "error" ]; then
    printf "\r  ${C_RED}[✖]${C_RESET} ${C_GRAY}[${C_RED}%s${C_GRAY}%s]${C_RESET} ${C_BOLD}${C_WHITE}%3d%%${C_RESET}  %s\033[K\n" "$f_str" "$e_str" "$pct" "$text"
  else
    printf "\r  ${C_CYAN}[➜]${C_RESET} ${C_GRAY}[${C_CYAN}%s${C_GRAY}%s]${C_RESET} ${C_BOLD}${C_WHITE}%3d%%${C_RESET}  ${C_GRAY}%s${C_RESET}\033[K" "$f_str" "$e_str" "$pct" "$text"
  fi
}

# Evita che la variabile generica DEBUG della shell sovrascriva backend/.env.
unset DEBUG

report_error() {
  local step_name="$1"
  local cmd_name="$2"
  echo
  echo "${C_RED}╭──────────────────────────────────────────────────────────────────╮${C_RESET}"
  echo "${C_RED}│${C_RESET}  ${C_BOLD}${C_WHITE}✖  ERRORE DURANTE LA CONFIGURAZIONE                             ${C_RESET}${C_RED}│${C_RESET}"
  echo "${C_RED}╰──────────────────────────────────────────────────────────────────╯${C_RESET}"
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
  echo "  ${C_BOLD}Log completo salvato in:${C_RESET} ${C_CYAN}${SETUP_LOG}${C_RESET}"
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
echo "${C_CYAN}╭──────────────────────────────────────────────────────────────────╮${C_RESET}"
echo "${C_CYAN}│${C_RESET}  ${C_BOLD}${C_WHITE}⚙  H I P L A N  ·  C O N F I G U R A Z I O N E                  ${C_RESET}${C_CYAN}│${C_RESET}"
echo "${C_CYAN}│${C_RESET}     ${C_GRAY}Installazione Iniziale & Preparazione Ambiente               ${C_RESET}${C_CYAN}│${C_RESET}"
echo "${C_CYAN}╰──────────────────────────────────────────────────────────────────╯${C_RESET}"
echo

echo "${C_BOLD}─── [ 1/4 ] Verifica Prerequisiti ─────────────────────────────────${C_RESET}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 non trovato nel PATH del sistema." > "$TEMP_LOG"
  report_error "Verifica Python" "which python3"
fi

if ! python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' > "$TEMP_LOG" 2>&1; then
  report_error "Versione Python non compatibile (richiesto >= 3.10)" "python3 --version"
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js o npm non trovati nel sistema." > "$TEMP_LOG"
  report_error "Verifica Node.js / npm" "which node && which npm"
fi

NODE_VERSION="$(node --version 2>/dev/null | tr -d 'v')"
NODE_MAJOR="$(echo "$NODE_VERSION" | cut -d. -f1)"

if (( NODE_MAJOR < 20 )); then
  echo "Versione Node.js $NODE_VERSION non supportata (richiesto 20.x LTS)." > "$TEMP_LOG"
  report_error "Versione Node.js obsoleta" "node --version"
fi

if [[ ! -f "$BACKEND_DIR/.env" ]]; then
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env" || report_error "Creazione .env" "cp .env.example .env"
fi

render_progress 15 done "Prerequisiti Python $(python3 --version | cut -d' ' -f2) e Node.js v$NODE_VERSION verificati"

echo
echo "${C_BOLD}─── [ 2/4 ] Preparazione Ambiente Python ──────────────────────────${C_RESET}"
render_progress 25 run "Creazione virtualenv ed installazione wheel/pip..."

if [[ ! -x "$BACKEND_DIR/venv/bin/python" ]]; then
  python3 -m venv "$BACKEND_DIR/venv" > "$TEMP_LOG" 2>&1 || report_error "Creazione virtualenv backend/venv" "python3 -m venv backend/venv"
fi

"$BACKEND_DIR/venv/bin/python" -m pip install --quiet --upgrade pip setuptools wheel > "$TEMP_LOG" 2>&1 || report_error "Aggiornamento pip e wheel" "pip install --upgrade pip"
render_progress 35 done "Virtualenv Python configurato e pip aggiornato"

render_progress 40 run "Installazione librerie da backend/requirements.txt..."
"$BACKEND_DIR/venv/bin/python" -m pip install --quiet -r "$BACKEND_DIR/requirements.txt" > "$TEMP_LOG" 2>&1 || report_error "Installazione requirements.txt" "pip install -r backend/requirements.txt"
render_progress 55 done "Dipendenze Python installate con successo"

echo
echo "${C_BOLD}─── [ 3/4 ] Installazione Dipendenze Frontend ──────────────────────${C_RESET}"
render_progress 60 run "Installazione pacchetti npm..."

if ! ( cd "$FRONTEND_DIR" && npm ci --prefer-offline --no-audit --no-fund > "$TEMP_LOG" 2>&1 ); then
  ( cd "$FRONTEND_DIR" && npm install --prefer-offline --no-audit --no-fund > "$TEMP_LOG" 2>&1 ) || report_error "Installazione dipendenze frontend" "cd frontend && npm install"
fi
render_progress 75 done "Dipendenze frontend installate con successo"

echo
echo "${C_BOLD}─── [ 4/4 ] Verifica Integrita' & Compilazione ────────────────────${C_RESET}"
render_progress 80 run "Verifica import backend FastAPI..."
(
  cd "$BACKEND_DIR"
  "$BACKEND_DIR/venv/bin/python" -c "import app.main"
) > "$TEMP_LOG" 2>&1 || report_error "Verifica modulo backend FastAPI" "python -c 'import app.main'"
render_progress 88 done "Backend FastAPI verificato con successo"

render_progress 90 run "Compilazione bundle frontend (npm run build)..."
(
  cd "$FRONTEND_DIR"
  npm run build
) > "$TEMP_LOG" 2>&1 || report_error "Compilazione frontend (npm run build)" "npm run build"
render_progress 95 done "Frontend Vite compilato con successo"

if [[ "$RUN_SEED" -eq 1 ]]; then
  echo
  echo "${C_BOLD}─── [EXTRA] Inserimento Dati Dimostrativi ─────────────────────────${C_RESET}"
  render_progress 96 run "Esecuzione seed.py..."
  (
    cd "$BACKEND_DIR"
    "$BACKEND_DIR/venv/bin/python" seed.py
  ) > "$TEMP_LOG" 2>&1 || report_error "Popolamento dati dimostrativi seed.py" "python seed.py"
  render_progress 99 done "Database popolato con dati dimostrativi"
fi

render_progress 100 done "Tutti i componenti installati e verificati!"

if [[ -f "$TEMP_LOG" ]]; then
  cat "$TEMP_LOG" >> "$SETUP_LOG" 2>/dev/null || true
  rm -f "$TEMP_LOG"
fi

echo
echo "${C_GREEN}╭──────────────────────────────────────────────────────────────────╮${C_RESET}"
echo "${C_GREEN}│${C_RESET}  ${C_BOLD}${C_WHITE}✔  CONFIGURAZIONE COMPLETATA CON SUCCESSO                       ${C_RESET}${C_GREEN}│${C_RESET}"
echo "${C_GREEN}╰──────────────────────────────────────────────────────────────────╯${C_RESET}"
echo
echo "  ${C_BOLD}Prossimi Passi:${C_RESET}"
echo "    ${C_GREEN}➜${C_RESET}  Avvia subito il server eseguendo:"
echo "       ${C_CYAN}${C_BOLD}./start_mac_server.sh${C_RESET}"
echo
echo "    ${C_GRAY}·  Configurazioni e variabili d'ambiente: backend/.env${C_RESET}"
echo "    ${C_GRAY}·  Log completo dell'installazione:       logs/setup.log${C_RESET}"
echo

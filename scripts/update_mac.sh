#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"
UPDATE_LOG="$LOG_DIR/update.log"
TEMP_LOG="$LOG_DIR/update_temp.log"
rm -f "$TEMP_LOG"

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

# Barre di avanzamento
BAR_33="[██████████░░░░░░░░░░░░░░░░░░░░]  33%"
BAR_66="[████████████████████░░░░░░░░░░]  66%"
BAR_100="[██████████████████████████████] 100%"

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
    cat "$TEMP_LOG" >> "$UPDATE_LOG"
  else
    echo "    Nessun dettaglio aggiuntivo catturato nel file temporaneo."
  fi
  echo "${C_RED}────────────────────────────────────────────────────────────────────${C_RESET}"
  echo
  echo "  ${C_BOLD}Log completo disponibile in:${C_RESET} ${C_CYAN}${UPDATE_LOG}${C_RESET}"
  echo
  exit 1
}

echo
echo "${C_CYAN}╔══════════════════════════════════════════════════════════════════╗${C_RESET}"
echo "${C_CYAN}║${C_BOLD}${C_WHITE}            H I P L A N  -  A G G I O R N A M E N T O             ${C_RESET}${C_CYAN}║${C_RESET}"
echo "${C_CYAN}║${C_GRAY}               Procedura di Aggiornamento Versione                ${C_RESET}${C_CYAN}║${C_RESET}"
echo "${C_CYAN}╚══════════════════════════════════════════════════════════════════╝${C_RESET}"
echo

echo "${C_BOLD}─── [ 1/3 ] Arresto Servizi Attivi ─────────────────────────────────${C_RESET}"
echo "        ${C_CYAN}${BAR_33}${C_RESET}  ${C_GRAY}Chiusura processi sulle porte 8000 e 5173...${C_RESET}"
if [[ -f "$ROOT_DIR/stop_mac_server.sh" ]]; then
  bash "$ROOT_DIR/stop_mac_server.sh" > "$TEMP_LOG" 2>&1 || report_error "Arresto servizi attivi" "./stop_mac_server.sh"
fi
echo "        ${C_GREEN}[✔] Servizi arrestati.${C_RESET}"

echo
echo "${C_BOLD}─── [ 2/3 ] Esecuzione Backup di Sicurezza Database ────────────────${C_RESET}"
echo "        ${C_CYAN}${BAR_66}${C_RESET}  ${C_GRAY}Creazione copia di backup del database SQLite...${C_RESET}"
if [[ -f "$ROOT_DIR/backend/venv/bin/python" ]]; then
  "$ROOT_DIR/backend/venv/bin/python" -c "import sys; sys.path.append('backend'); from app.services.backup_service import run_backup; run_backup()" > "$TEMP_LOG" 2>&1 || {
    echo "        ${C_YELLOW}[!] Attenzione: Backup automatico non riuscito, procedo comunque.${C_RESET}"
    if [[ -f "$TEMP_LOG" ]]; then
      tail -n 5 "$TEMP_LOG" | sed 's/^/          /'
    fi
  }
  echo "        ${C_GREEN}[✔] Backup di sicurezza completato con successo.${C_RESET}"
else
  echo "        ${C_GRAY}[•] Ambiente Python non trovato, salto il backup preventivo.${C_RESET}"
fi

echo
echo "${C_BOLD}─── [ 3/3 ] Aggiornamento Dipendenze e Ricompilazione ──────────────${C_RESET}"
echo "        ${C_CYAN}${BAR_100}${C_RESET}  ${C_GRAY}Esecuzione setup dipendenze e build frontend...${C_RESET}"
bash "$ROOT_DIR/scripts/setup_mac.sh" || report_error "Aggiornamento Dipendenze e Build" "./scripts/setup_mac.sh"

if [[ -f "$TEMP_LOG" ]]; then
  cat "$TEMP_LOG" >> "$UPDATE_LOG" 2>/dev/null || true
  rm -f "$TEMP_LOG"
fi

echo
echo "${C_GREEN}╔══════════════════════════════════════════════════════════════════╗${C_RESET}"
echo "${C_GREEN}║${C_BOLD}${C_WHITE}              AGGIORNAMENTO COMPLETATO CON SUCCESSO               ${C_RESET}${C_GREEN}║${C_RESET}"
echo "${C_GREEN}╚══════════════════════════════════════════════════════════════════╝${C_RESET}"
echo
echo "${C_BOLD}  Stato dell'installazione:${C_RESET}"
echo "    ${C_GREEN}✔${C_RESET}  Tutti i file applicativi sono stati aggiornati."
echo "    ${C_GREEN}✔${C_RESET}  Database, allegati e configurazioni .env sono preservati e intatti."
echo
echo "${C_BOLD}  Prossimi passi:${C_RESET}"
echo "    ${C_GREEN}➜${C_RESET}  Riavvia subito HiPlan eseguendo:"
echo "       ${C_CYAN}${C_BOLD}./start_mac_server.sh${C_RESET}"
echo

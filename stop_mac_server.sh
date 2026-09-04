#!/usr/bin/env bash

set -Eeuo pipefail

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

echo
echo "${C_BLUE}╔══════════════════════════════════════════════════════════════════╗${C_RESET}"
echo "${C_BLUE}║${C_BOLD}${C_WHITE}                  H I P L A N  -  A R R E S T O                   ${C_RESET}${C_BLUE}║${C_RESET}"
echo "${C_BLUE}║${C_GRAY}                Chiusura Servizi e Processi Attivi                ${C_RESET}${C_BLUE}║${C_RESET}"
echo "${C_BLUE}╚══════════════════════════════════════════════════════════════════╝${C_RESET}"
echo

echo "${C_CYAN}[1/2]${C_RESET} Ricerca processi su porta 8000 (Backend API)..."
PIDS_8000=$(lsof -ti:8000 2>/dev/null || true)
if [[ -n "$PIDS_8000" ]]; then
  echo "$PIDS_8000" | xargs kill -9 2>/dev/null || true
  for pid in $PIDS_8000; do
    echo "      ${C_GREEN}[✔]${C_RESET} Processo PID $pid terminato."
  done
else
  echo "      ${C_GRAY}[•] Nessun processo attivo trovato sulla porta 8000.${C_RESET}"
fi

echo "${C_CYAN}[2/2]${C_RESET} Ricerca processi su porta 5173 (Frontend Web)..."
PIDS_5173=$(lsof -ti:5173 2>/dev/null || true)
if [[ -n "$PIDS_5173" ]]; then
  echo "$PIDS_5173" | xargs kill -9 2>/dev/null || true
  for pid in $PIDS_5173; do
    echo "      ${C_GREEN}[✔]${C_RESET} Processo PID $pid terminato."
  done
else
  echo "      ${C_GRAY}[•] Nessun processo attivo trovato sulla porta 5173.${C_RESET}"
fi

echo
echo "${C_GREEN}╔══════════════════════════════════════════════════════════════════╗${C_RESET}"
echo "${C_GREEN}║${C_BOLD}${C_WHITE}              SERVIZI HIPLAN ARRESTATI CON SUCCESSO               ${C_RESET}${C_GREEN}║${C_RESET}"
echo "${C_GREEN}╚══════════════════════════════════════════════════════════════════╝${C_RESET}"
echo
echo "  Tutti i processi associati a HiPlan sono stati chiusi correttamente."
echo

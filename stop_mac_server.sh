#!/usr/bin/env bash

set -Eeuo pipefail

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

echo
echo "${C_BLUE}╭──────────────────────────────────────────────────────────────────╮${C_RESET}"
echo "${C_BLUE}│${C_RESET}  ${C_BOLD}${C_WHITE}■  H I P L A N  ·  A R R E S T O  S E R V I Z I                 ${C_RESET}${C_BLUE}│${C_RESET}"
echo "${C_BLUE}│${C_RESET}     ${C_GRAY}Chiusura Servizi e Processi Attivi                           ${C_RESET}${C_BLUE}│${C_RESET}"
echo "${C_BLUE}╰──────────────────────────────────────────────────────────────────╯${C_RESET}"
echo

advance_bar 30 "Ricerca processi porta 8000..."
PIDS_8000=$(lsof -ti:8000 2>/dev/null || true)
if [[ -n "$PIDS_8000" ]]; then
  kill -9 $PIDS_8000 2>/dev/null || true
fi
advance_bar 50 "Backend API arrestato"

advance_bar 75 "Ricerca processi porta 5173..."
PIDS_5173=$(lsof -ti:5173 2>/dev/null || true)
if [[ -n "$PIDS_5173" ]]; then
  kill -9 $PIDS_5173 2>/dev/null || true
fi
advance_bar 85 "Frontend Web arrestato"

pkill -9 -f "uvicorn app.main:app" 2>/dev/null || true
pkill -9 -f "vite.*5173" 2>/dev/null || true

advance_bar 100 "Chiusura completata"
finish_bar "Servizi HiPlan arrestati con successo"

echo "${C_GREEN}╭──────────────────────────────────────────────────────────────────╮${C_RESET}"
echo "${C_GREEN}│${C_RESET}  ${C_BOLD}${C_WHITE}✔  SERVIZI HIPLAN ARRESTATI CON SUCCESSO                        ${C_RESET}${C_GREEN}│${C_RESET}"
echo "${C_GREEN}╰──────────────────────────────────────────────────────────────────╯${C_RESET}"
echo

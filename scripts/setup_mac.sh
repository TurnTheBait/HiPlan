#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
RUN_SEED=0

# Evita che la variabile generica DEBUG della shell sovrascriva backend/.env.
unset DEBUG

if [[ "${1:-}" == "--seed" ]]; then
  RUN_SEED=1
elif [[ -n "${1:-}" ]]; then
  echo "Uso: ./setup_mac.sh [--seed]"
  exit 2
fi

echo "========================================================"
echo "  HiPlan - configurazione macOS"
echo "========================================================"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[ERRORE] Python 3 non trovato. Installa Python 3.12 o successivo."
  exit 1
fi

if ! python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)'; then
  echo "[ERRORE] Serve Python 3.12 o successivo."
  python3 --version
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "[ERRORE] Node.js e npm non trovati. Installa Node.js 20.19 o successivo."
  exit 1
fi

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 20 || (major === 20 && minor >= 19) ? 0 : 1)'; then
  echo "[ERRORE] Serve Node.js 20.19 o successivo. Versione rilevata: $(node --version)"
  exit 1
fi

if [[ ! -f "$BACKEND_DIR/.env" ]]; then
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
  echo "[OK] Creato backend/.env da .env.example."
fi

echo
echo "[1/3] Preparazione ambiente Python..."
if [[ ! -x "$BACKEND_DIR/venv/bin/python" ]]; then
  python3 -m venv "$BACKEND_DIR/venv"
fi
"$BACKEND_DIR/venv/bin/python" -m pip install --upgrade pip
"$BACKEND_DIR/venv/bin/python" -m pip install -r "$BACKEND_DIR/requirements.txt"

echo
echo "[2/3] Installazione dipendenze frontend..."
(
  cd "$FRONTEND_DIR"
  npm ci
)

echo
echo "[3/3] Verifica installazione..."
(
  cd "$BACKEND_DIR"
  "$BACKEND_DIR/venv/bin/python" -c "import app.main"
)
(
  cd "$FRONTEND_DIR"
  npm run build
)

if [[ "$RUN_SEED" -eq 1 ]]; then
  echo
  echo "[EXTRA] Inserimento dati dimostrativi..."
  (
    cd "$BACKEND_DIR"
    "$BACKEND_DIR/venv/bin/python" seed.py
  )
fi

echo
echo "========================================================"
echo "  Configurazione completata."
echo "  Avvio locale: ./start.sh"
echo "  Avvio in LAN: ./start_mac_server.sh"
echo "========================================================"

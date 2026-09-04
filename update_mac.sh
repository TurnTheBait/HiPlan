#!/usr/bin/env bash
# Launcher principale per l'aggiornamento macOS di HiPlan
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "$SCRIPT_DIR/scripts/update_mac.sh" "$@"

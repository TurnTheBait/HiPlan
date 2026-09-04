#!/usr/bin/env bash
# Launcher principale per la configurazione macOS di HiPlan
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "$SCRIPT_DIR/scripts/setup_mac.sh" "$@"

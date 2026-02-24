#!/bin/sh
set -eu
. "$(dirname "$0")/lib.sh"

cleanup() {
  if [ -n "${BRIDGE_PID:-}" ] && kill -0 "$BRIDGE_PID" 2>/dev/null; then
    kill "$BRIDGE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "[lab] starting bridge on 8100..."
BRIDGE_PORT=8100 npm run start:bridge &
BRIDGE_PID=$!

sleep 1

echo "[lab] starting orchestrator..."
exec npm run start:orchestrator

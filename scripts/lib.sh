#!/bin/sh
set -eu

PROJECT_DIR="/Users/charles/Documents/New project"
cd "$PROJECT_DIR"

if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi

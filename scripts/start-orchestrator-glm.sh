#!/bin/sh
set -eu
. "$(dirname "$0")/lib.sh"

if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "OPENAI_API_KEY is not set. Create .env.local from .env.local.example and fill it." >&2
  exit 1
fi

exec npm run start:orchestrator

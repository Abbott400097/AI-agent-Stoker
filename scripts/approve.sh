#!/bin/sh
set -eu
. "$(dirname "$0")/lib.sh"

if [ "$#" -lt 1 ]; then
  echo "Usage: scripts/approve.sh <decisionId>" >&2
  exit 1
fi

curl -X POST http://127.0.0.1:8787/api/decisions/approve \
  -H 'Content-Type: application/json' \
  -d "{\"decisionId\":\"$1\",\"source\":\"manual\"}"

echo

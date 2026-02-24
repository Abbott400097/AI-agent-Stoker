#!/bin/sh
set -eu
. "$(dirname "$0")/lib.sh"

curl -X POST http://127.0.0.1:8787/api/autopilot/start \
  -H 'Content-Type: application/json' \
  -d '{}'
echo

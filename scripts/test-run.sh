#!/bin/sh
set -eu
. "$(dirname "$0")/lib.sh"

curl -X POST http://127.0.0.1:8787/api/config \
  -H 'Content-Type: application/json' \
  -d '{"bridgeEndpoint":"http://127.0.0.1:8100/eastmoney-sim/order","bridgeSimulate":false}'

echo

curl --max-time 45 -X POST http://127.0.0.1:8787/webhooks/discord/commands \
  -H 'Content-Type: application/json' \
  -d '{"content":"RUN 600519.SH hybrid"}'

echo

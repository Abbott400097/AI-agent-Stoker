#!/bin/sh
set -eu
. "$(dirname "$0")/lib.sh"

curl -X POST http://127.0.0.1:8787/api/config \
  -H 'Content-Type: application/json' \
  -d '{"bridgeEndpoint":"http://127.0.0.1:8100/eastmoney-sim/order","bridgeSimulate":false}'

echo

if [ -n "${OPENCLAW_SHARED_SECRET:-}" ]; then
  curl --max-time 45 -X POST http://127.0.0.1:8787/webhooks/openclaw \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer ${OPENCLAW_SHARED_SECRET}" \
    -d '{"action":"RUN","symbol":"600519.SH","mode":"hybrid"}'
else
  curl --max-time 45 -X POST http://127.0.0.1:8787/webhooks/openclaw \
    -H 'Content-Type: application/json' \
    -d '{"action":"RUN","symbol":"600519.SH","mode":"hybrid"}'
fi

echo

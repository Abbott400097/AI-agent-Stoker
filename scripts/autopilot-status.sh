#!/bin/sh
set -eu
. "$(dirname "$0")/lib.sh"

curl http://127.0.0.1:8787/api/autopilot/status
echo

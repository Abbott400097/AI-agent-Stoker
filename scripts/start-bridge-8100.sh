#!/bin/sh
set -eu
. "$(dirname "$0")/lib.sh"

export BRIDGE_PORT=8100
exec npm run start:bridge

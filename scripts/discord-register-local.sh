#!/bin/sh
set -eu
. "$(dirname "$0")/lib.sh"

if [ -z "${DISCORD_APPLICATION_ID:-}" ] || [ -z "${DISCORD_BOT_TOKEN:-}" ] || [ -z "${DISCORD_GUILD_ID:-}" ]; then
  echo "Missing DISCORD_APPLICATION_ID / DISCORD_BOT_TOKEN / DISCORD_GUILD_ID in .env.local" >&2
  exit 1
fi

exec node backend/scripts/register_discord_commands.mjs

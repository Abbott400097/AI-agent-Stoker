#!/bin/sh
set -eu
. "$(dirname "$0")/lib.sh"

missing=0

check_var() {
  name="$1"
  value="$(eval "printf '%s' \"\${$name:-}\"")"
  if [ -z "$value" ]; then
    echo "MISSING: $name"
    missing=1
    return
  fi

  case "$name" in
    DISCORD_BOT_TOKEN)
      echo "OK: $name=${value%????????????????}********"
      ;;
    DISCORD_PUBLIC_KEY)
      echo "OK: $name=${value%????????}********"
      ;;
    OPENAI_API_KEY)
      echo "OK: $name=${value%????????}********"
      ;;
    *)
      echo "OK: $name=$value"
      ;;
  esac
}

check_var DISCORD_APPLICATION_ID
check_var DISCORD_GUILD_ID
check_var DISCORD_BOT_TOKEN
check_var DISCORD_PUBLIC_KEY
check_var OPENAI_API_KEY

echo "INFO: Interactions endpoint path=/webhooks/discord/interactions"
echo "INFO: Local orchestrator URL=http://127.0.0.1:8787"

if [ "$missing" -ne 0 ]; then
  echo "FAIL: Fill missing vars in .env.local" >&2
  exit 1
fi

echo "PASS: Discord + GLM local env looks ready."

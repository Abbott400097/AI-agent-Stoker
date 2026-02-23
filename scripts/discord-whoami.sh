#!/bin/sh
set -eu
. "$(dirname "$0")/lib.sh"

mask_tail() {
  value="$1"
  keep="${2:-6}"
  len=$(printf "%s" "$value" | wc -c | tr -d ' ')
  if [ "$len" -le "$keep" ]; then
    printf "%s\n" "$value"
    return
  fi
  # shellcheck disable=SC2004
  cut_len=$((len - keep))
  prefix=$(printf "%s" "$value" | cut -c1-$cut_len)
  printf "%s%s\n" "$prefix" "******"
}

printf "DISCORD_APPLICATION_ID=%s\n" "${DISCORD_APPLICATION_ID:-}"
printf "DISCORD_GUILD_ID=%s\n" "${DISCORD_GUILD_ID:-}"
printf "DISCORD_PUBLIC_KEY=%s\n" "$(mask_tail "${DISCORD_PUBLIC_KEY:-}" 8)"
printf "DISCORD_BOT_TOKEN=%s\n" "$(mask_tail "${DISCORD_BOT_TOKEN:-}" 10)"
printf "INTERACTIONS_LOCAL=http://127.0.0.1:8787/webhooks/discord/interactions\n"

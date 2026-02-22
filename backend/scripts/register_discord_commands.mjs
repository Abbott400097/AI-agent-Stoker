import { listDiscordSlashCommands } from '../lib/command_router.mjs';

const appId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!appId || !botToken || !guildId) {
  console.error('Missing DISCORD_APPLICATION_ID / DISCORD_BOT_TOKEN / DISCORD_GUILD_ID');
  process.exit(1);
}

const commands = listDiscordSlashCommands();
const url = `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`;

const res = await fetch(url, {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bot ${botToken}`
  },
  body: JSON.stringify(commands)
});

const text = await res.text();
if (!res.ok) {
  console.error(`Discord API ${res.status}: ${text}`);
  process.exit(1);
}

console.log(text);

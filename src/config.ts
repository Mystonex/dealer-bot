import 'dotenv/config';

function readMinutes(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
  token: process.env.DISCORD_TOKEN ?? '',
  clientId: process.env.DISCORD_CLIENT_ID ?? '',
  guildId: process.env.DISCORD_DEV_GUILD_ID ?? '',

  // Events channel (required)
  eventChannelId: process.env.EVENT_CHANNEL_ID ?? '',

  // Timezone for parsing (renders show in viewer's local TZ)
  tzDefault: process.env.TZ_DEFAULT ?? 'UTC',

  // Event Hub behavior
  eventHubPin: (process.env.EVENT_HUB_PIN ?? 'false').toLowerCase() === 'true',
  eventHubAlwaysLast: (process.env.EVENT_HUB_ALWAYS_LAST ?? 'true').toLowerCase() === 'true',
  eventHubBumpCooldownMs: Number(process.env.EVENT_HUB_BUMP_COOLDOWN_SEC ?? '60') * 1000,

  // Command housekeeping
  cleanupGlobalOnStart:
    (process.env.CLEANUP_GLOBAL_COMMANDS ?? 'true').toLowerCase() === 'true',

  // User ping reminders (minutes before event start)
  userPingMinutes: [
    readMinutes('USERPING_1', 1440), // 24h
    readMinutes('USERPING_2', 360),  // 6h
    readMinutes('USERPING_3', 60),   // 1h
    readMinutes('USERPING_4', 15),   // 15m
  ],

  // scheduler tick (seconds)
  userPingTickSec: Number(process.env.USERPING_TICK_SEC ?? '30'),
};

if (!config.token) throw new Error('Missing DISCORD_TOKEN');
if (!config.clientId) throw new Error('Missing DISCORD_CLIENT_ID');
if (!config.eventChannelId) throw new Error('Missing EVENT_CHANNEL_ID');
if (!config.guildId) console.warn('⚠️ No DISCORD_DEV_GUILD_ID set — guild command registration will be skipped.');

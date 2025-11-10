import { GatewayIntentBits, Events, ActivityType } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { loadCommands } from './handlers/commandHandler.js';
import { DealClient } from './client.js';
import { initDB } from './db/index.js';
import { ensureStarterMessage, bumpStarterMessage } from './services/starterMessage.js';

// Initialize DB first
await initDB();

// IMPORTANT: subscribe to message events (+ MessageContent for best compatibility)
const client = new DealClient({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // safe to include; we don't read content but some guilds/dev-portal settings gate delivery otherwise
  ],
});

// Load commands
await loadCommands(client);

// Load event listeners
const eventsPath = path.resolve('src/events');
const eventFiles = fs.readdirSync(eventsPath).filter((f) => f.endsWith('.ts') || f.endsWith('.js'));

for (const file of eventFiles) {
  const event = await import(`./events/${file}`);
  if (event.once) client.once(event.name, (...args) => event.execute(...args));
  else client.on(event.name, (...args) => event.execute(...args));
}

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  c.user.setPresence({
    activities: [{ name: 'BPSR ;-)', type: ActivityType.Playing }],
    status: 'online',
  });

  // Ensure the persistent "Event Hub" exists…
  await ensureStarterMessage(c);
  // …and force-bump it once on startup so it’s the latest message.
  await bumpStarterMessage(c, true);
});

client.login(config.token);

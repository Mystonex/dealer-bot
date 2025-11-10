import { REST, Routes, Collection, Client } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import type { Command } from '../types/command.js';

export async function loadCommands(client: Client & { commands?: Collection<string, Command> }) {
  const commands = new Collection<string, Command>();
  const commandsData: any[] = [];

  // discover command files
  const commandsPath = path.resolve('src/commands');
  const files = fs
    .readdirSync(commandsPath)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.js'));

  console.log('🔎 Found command files:', files.length ? `[ ${files.join(', ')} ]` : '[ none ]');

  for (const file of files) {
    const mod = await import(`../commands/${file}`);
    const { data, execute } = mod;
    if (!data || !execute) continue;

    commands.set(data.name, { data, execute });
    commandsData.push(data.toJSON());
  }

  // expose to client
  client.commands = commands;

  const rest = new REST({ version: '10' }).setToken(config.token);

  // 1) (Optional) wipe GLOBAL commands so old leftovers disappear
  if (config.cleanupGlobalOnStart) {
    try {
      console.log('🧹 Clearing GLOBAL application commands…');
      await rest.put(Routes.applicationCommands(config.clientId), { body: [] });
      console.log('✅ Global commands cleared.');
    } catch (err) {
      console.error('❌ Failed to clear global commands:', err);
    }
  }

  // 2) Register to a single dev guild (fast propagation + overwrites old guild cmds)
  if (config.guildId) {
    try {
      console.log(
        `⏳ Registering ${commandsData.length} command(s) to guild ${config.guildId}: ${commands
          .map((_, k) => k)
          .join(', ') || '(none)'}`
      );
      await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
        body: commandsData,
      });
      console.log('✅ Now registered:', `[ ${commands.map((_, k) => k).join(', ')} ]`);
    } catch (err) {
      console.error('❌ Failed to register guild commands:', err);
    }
  } else {
    console.warn('⚠️ Skipping guild registration (no DISCORD_DEV_GUILD_ID set).');
  }
}

import { Events, Message } from 'discord.js';
import { config } from '../config.js';
import { bumpStarterMessage } from '../services/starterMessage.js';

export const name = Events.MessageCreate;

export async function execute(message: Message) {
  // Only in the configured events channel
  if (message.channelId !== config.eventChannelId) return;

  // Ignore bot messages (including the hub itself)
  if (message.author.bot) return;

  // Bump the hub so it becomes the latest message
  await bumpStarterMessage(message.client);
}

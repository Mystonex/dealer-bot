import { Client, Events } from 'discord.js';
import { startUserPingScheduler } from '../services/userPing.js';

export const name = Events.ClientReady;

export async function execute(client: Client) {
  // Start the reminder scheduler when the bot becomes ready
  startUserPingScheduler(client);
}

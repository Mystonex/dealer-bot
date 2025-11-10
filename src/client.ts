import { Client, Collection, ClientOptions } from 'discord.js';
import type { Command } from './types/command.js';

export class DealClient extends Client {
  public commands = new Collection<string, Command>();
  constructor(options: ClientOptions) {
    super(options);
  }
}

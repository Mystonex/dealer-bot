import { Collection } from 'discord.js';

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      DISCORD_TOKEN: string;
      DISCORD_CLIENT_ID: string;
      DISCORD_DEV_GUILD_ID?: string;

      EVENT_CHANNEL_ID: string;
      TZ_DEFAULT?: string;

      EVENT_HUB_PIN?: string;
      EVENT_HUB_ALWAYS_LAST?: string;
      EVENT_HUB_BUMP_COOLDOWN_SEC?: string;

      CLEANUP_GLOBAL_COMMANDS?: string;

      USERPING_1?: string;
      USERPING_2?: string;
      USERPING_3?: string;
      USERPING_4?: string;
      USERPING_TICK_SEC?: string;
    }
  }
}

declare module 'discord.js' {
  interface Client {
    commands: Collection<string, any>;
  }
}

export {};

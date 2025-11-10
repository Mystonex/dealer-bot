import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  userMention,
} from 'discord.js';
import { getDB } from '../db/index.js';

export type StoredEvent = {
  id: string;
  guildId: string;
  channelId: string;
  name: string;
  hostId: string;
  description?: string;
  whenText?: string;
  whenUnix?: number;
  max?: number;
  threadId?: string;
  participants: Set<string>;
};

const cache = new Map<string, StoredEvent>();

function now() {
  return Math.floor(Date.now() / 1000);
}

export const EventStore = {
  get(id: string) {
    return cache.get(id);
  },

  async hydrate(id: string) {
    const db = getDB();
    const row = db
      .prepare(
        `SELECT id, guildId, channelId, name, hostId, description, whenText, whenUnix, max, threadId
         FROM events WHERE id = ?`
      )
      .get(id) as any;

    if (!row) return null;

    const parts = db
      .prepare(`SELECT userId FROM participants WHERE eventId = ?`)
      .all(id) as Array<{ userId: string }>;

    const ev: StoredEvent = {
      ...row,
      whenUnix: row.whenUnix ?? undefined,
      max: row.max ?? undefined,
      threadId: row.threadId ?? undefined,
      description: row.description ?? undefined,
      whenText: row.whenText ?? undefined,
      participants: new Set(parts.map((p) => p.userId)),
    };

    cache.set(id, ev);
    return ev;
  },

  create(input: Omit<StoredEvent, 'participants' | 'threadId'> & { threadId?: string }) {
    const db = getDB();

    db.prepare(
      `INSERT INTO events (id, guildId, channelId, name, hostId, description, whenText, whenUnix, max, createdAt, updatedAt, threadId)
       VALUES (@id, @guildId, @channelId, @name, @hostId, @description, @whenText, @whenUnix, @max, @createdAt, @updatedAt, @threadId)`
    ).run({
      id: input.id,
      guildId: input.guildId,
      channelId: input.channelId,
      name: input.name,
      hostId: input.hostId,
      description: input.description ?? null,
      whenText: input.whenText ?? null,
      whenUnix: input.whenUnix ?? null,
      max: input.max ?? null,
      threadId: input.threadId ?? null,
      createdAt: now(),
      updatedAt: now(),
    });

    const ev: StoredEvent = {
      ...input,
      participants: new Set<string>(),
      threadId: input.threadId,
    };

    cache.set(ev.id, ev);
    return ev;
  },

  setThreadId(eventId: string, threadId: string) {
    const db = getDB();
    db.prepare(`UPDATE events SET threadId = ?, updatedAt = ? WHERE id = ?`).run(threadId, now(), eventId);
    const ev = cache.get(eventId);
    if (ev) ev.threadId = threadId;
  },

  join(eventId: string, userId: string) {
    const ev = cache.get(eventId);
    if (!ev) return { ok: false as const, reason: 'MISSING' as const };
    if (ev.max && ev.participants.size >= ev.max) return { ok: false as const, reason: 'FULL' as const };
    if (ev.participants.has(userId)) return { ok: false as const, reason: 'ALREADY' as const };

    const db = getDB();
    db.prepare(`INSERT OR IGNORE INTO participants (eventId, userId, joinedAt) VALUES (?, ?, ?)`).run(
      eventId,
      userId,
      now()
    );
    ev.participants.add(userId);
    db.prepare(`UPDATE events SET updatedAt = ? WHERE id = ?`).run(now(), eventId);

    return { ok: true as const };
  },

  leave(eventId: string, userId: string) {
    const ev = cache.get(eventId);
    if (!ev) return { ok: false as const, reason: 'MISSING' as const };
    if (!ev.participants.has(userId)) return { ok: false as const, reason: 'NOT_IN' as const };

    const db = getDB();
    db.prepare(`DELETE FROM participants WHERE eventId = ? AND userId = ?`).run(eventId, userId);
    ev.participants.delete(userId);
    db.prepare(`UPDATE events SET updatedAt = ? WHERE id = ?`).run(now(), eventId);

    return { ok: true as const };
  },

  renderEmbed(ev: StoredEvent) {
    const e = new EmbedBuilder()
      .setTitle(`⚔️ ${ev.name}`)
      .setDescription(ev.description || null);

    e.addFields({ name: 'Host', value: userMention(ev.hostId), inline: false });

    if (ev.whenUnix) {
      e.addFields({
        name: 'When',
        value: `<t:${ev.whenUnix}:F>\n<t:${ev.whenUnix}:R>`,
        inline: false,
      });
    } else if (ev.whenText) {
      e.addFields({ name: 'When', value: ev.whenText, inline: false });
    }

    e.addFields({ name: '\u200B', value: '_Times show in your local timezone._', inline: false });

    if (ev.max) {
      e.addFields({
        name: 'Spots',
        value: `${ev.participants.size}/${ev.max}`,
        inline: false,
      });
    } else {
      e.addFields({
        name: 'Going',
        value: ev.participants.size ? [...ev.participants].map(userMention).join('\n') : '—',
        inline: false,
      });
    }

    if (ev.max) {
      e.addFields({
        name: 'Going',
        value: ev.participants.size ? [...ev.participants].map(userMention).join('\n') : '—',
        inline: false,
      });
    }

    e.setFooter({ text: `Event ID: ${ev.id}` });
    return e;
  },

  renderButtons(ev: StoredEvent) {
    const row = new ActionRowBuilder<ButtonBuilder>();

    row.addComponents(
      new ButtonBuilder()
        .setCustomId('event:join')
        .setLabel('Join')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('event:leave')
        .setLabel('Leave')
        .setStyle(ButtonStyle.Secondary)
    );

    if (ev.threadId) {
      // Link to existing thread
      row.addComponents(
        new ButtonBuilder()
          .setLabel('Open Thread')
          .setEmoji('🚀')
          .setStyle(ButtonStyle.Link)
          .setURL(`https://discord.com/channels/${ev.guildId}/${ev.threadId}`)
      );
    } else {
      // Start a new planning thread
      row.addComponents(
        new ButtonBuilder()
          .setCustomId('event:start-thread')
          .setLabel('Ready! Start Thread')
          .setEmoji('🚀')
          .setStyle(ButtonStyle.Primary)
      );
    }

    return row;
  },
};

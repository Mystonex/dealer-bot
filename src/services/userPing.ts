import { Client, AnyThreadChannel, TextChannel } from 'discord.js';
import { getDB } from '../db/index.js';
import { config } from '../config.js';

type EventRow = {
  id: string;
  guildId: string;
  channelId: string;
  name: string;
  hostId: string;
  whenUnix: number | null;
  threadId: string | null;
};

type ReminderState = {
  eventId: string;
  sent1: number;
  sent2: number;
  sent3: number;
  sent4: number;
};

function humanizeMinutes(m: number) {
  if (m % 60 === 0) {
    const h = Math.round(m / 60);
    return h === 1 ? '1 hour' : `${h} hours`;
  }
  return m === 1 ? '1 minute' : `${m} minutes`;
}

function ensureReminderRow(eventId: string) {
  const db = getDB();
  db.prepare(`
    INSERT INTO event_reminders (eventId, sent1, sent2, sent3, sent4)
    VALUES (?, 0, 0, 0, 0)
    ON CONFLICT(eventId) DO NOTHING
  `).run(eventId);
}

function loadReminder(eventId: string): ReminderState {
  const db = getDB();
  const row = db.prepare(`
    SELECT eventId, sent1, sent2, sent3, sent4
    FROM event_reminders
    WHERE eventId = ?
  `).get(eventId) as ReminderState | undefined;

  if (!row) {
    ensureReminderRow(eventId);
    return { eventId, sent1: 0, sent2: 0, sent3: 0, sent4: 0 };
  }
  return row;
}

function markSentDB(eventId: string, idx: 1 | 2 | 3 | 4) {
  const col = idx === 1 ? 'sent1' : idx === 2 ? 'sent2' : idx === 3 ? 'sent3' : 'sent4';
  getDB().prepare(`UPDATE event_reminders SET ${col} = ? WHERE eventId = ?`).run(Date.now(), eventId);
}

function markSentLocal(state: ReminderState, idx: 1 | 2 | 3 | 4) {
  const now = Date.now();
  if (idx === 1) state.sent1 = now;
  else if (idx === 2) state.sent2 = now;
  else if (idx === 3) state.sent3 = now;
  else state.sent4 = now;
}

function isSent(state: ReminderState, i: 0 | 1 | 2 | 3) {
  return (i === 0 ? state.sent1 : i === 1 ? state.sent2 : i === 2 ? state.sent3 : state.sent4) !== 0;
}

async function sendReminder(
  client: Client,
  ev: EventRow,
  participants: string[],
  which: 0 | 1 | 2 | 3
) {
  if (!ev.threadId) return;
  const channel = await client.channels.fetch(ev.threadId).catch(() => null);
  if (!channel || (!('send' in channel))) return;

  const uniq = Array.from(new Set(participants));

  const minutesCfg = config.userPingMinutes[which];
  const labelCfg = humanizeMinutes(minutesCfg);

  // Dynamic relative timestamp (live countdown like the "When" line)
  const dynamicRel = `<t:${Math.floor(ev.whenUnix as number)}:R>`;

  const copy = [
    // 24h
    `⏰ Heads-up ${uniq.map(u => `<@${u}>`).join(', ')} — **${ev.name}** starts in ${labelCfg}. Already excited? 😉`,
    // 6h
    `⏰ Reminder ${uniq.map(u => `<@${u}>`).join(', ')} — **${ev.name}** starts in ${labelCfg}. The wait is nearly over!`,
    // 1h
    `⏰ Final reminder ${uniq.map(u => `<@${u}>`).join(', ')} — **${ev.name}** starts in ${labelCfg}. Warm up and grab snacks.`,
    // 15m (dynamic relative time; grammar-friendly)
    `🚀 ${uniq.map(u => `<@${u}>`).join(', ')} — **${ev.name}** starts ${dynamicRel}! Get ready, prepare your buffs — good luck and good loot! 😄`,
  ] as const;

  await (channel as TextChannel | AnyThreadChannel).send({
    content: copy[which],
    allowedMentions: { users: uniq },
  });
}

export function startUserPingScheduler(client: Client) {
  const db = getDB();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS event_reminders (
      eventId TEXT PRIMARY KEY,
      sent1 INTEGER DEFAULT 0,
      sent2 INTEGER DEFAULT 0,
      sent3 INTEGER DEFAULT 0,
      sent4 INTEGER DEFAULT 0
    )
  `).run();

  const tickMs = Math.max(10, Math.floor((Number(config.userPingTickSec ?? 30)) * 1000));

  const tick = async () => {
    try {
      const nowSec = Math.floor(Date.now() / 1000);

      // Include last 7 days to catch missed windows after a restart.
      const rows = db.prepare(`
        SELECT id, guildId, channelId, name, hostId, whenUnix, threadId
        FROM events
        WHERE threadId IS NOT NULL
          AND whenUnix IS NOT NULL
          AND whenUnix > ?
      `).all(nowSec - 7 * 24 * 3600) as EventRow[];

      for (const ev of rows) {
        const participants = db
          .prepare(`SELECT userId FROM participants WHERE eventId = ?`)
          .all(ev.id)
          .map((r: any) => r.userId as string);

        if (participants.length === 0) continue;

        ensureReminderRow(ev.id);
        const state = loadReminder(ev.id);

        const schedule = config.userPingMinutes;
        const dueIndices: (0 | 1 | 2 | 3)[] = [];
        for (let i = 0 as 0 | 1 | 2 | 3; i < 4; i = (i + 1) as any) {
          if (isSent(state, i)) continue;
          const dueAt = (ev.whenUnix as number) - schedule[i] * 60;
          if (Math.floor(Date.now() / 1000) >= dueAt) {
            dueIndices.push(i);
          }
        }

        if (dueIndices.length > 0) {
          // Send ONLY the closest relevant reminder (largest index = closest to start).
          const iToSend = dueIndices.reduce((a, b) => (a > b ? a : b));
          await sendReminder(client, ev, participants, iToSend);

          // Mark all due ones as sent so they won't trickle in later.
          for (const i of dueIndices) {
            markSentDB(ev.id, (i + 1) as 1 | 2 | 3 | 4);
            markSentLocal(state, (i + 1) as 1 | 2 | 3 | 4);
          }
        }
      }
    } catch (err) {
      console.error('[userping] tick failed:', err);
    }
  };

  setInterval(() => void tick(), tickMs);
  setTimeout(() => void tick(), 5000);

  console.log(`[userping] scheduler started (every ${Math.round(tickMs / 1000)}s).`);
}

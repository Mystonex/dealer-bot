import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  TextChannel,
  Client,
  AnyThreadChannel,
  Message,
} from 'discord.js';
import { DateTime } from 'luxon';
import { config } from '../config.js';
import { getControlMessage, upsertControlMessage, getDB } from '../db/index.js';

const TYPE = 'event-starter';
let lastBumpAt = 0;

// Only post an "open now" announcement on startup if we're within this many minutes after the start
const ANNOUNCE_GRACE_MIN = 10;

// Event post/threads cleanup
const CLEANUP_DELAY_MIN = 120;               // 2 hours after event start
const CLEANUP_SWEEP_MIN = 15;                // run sweep every 15 minutes
const CLEANUP_SCAN_BATCHES = 5;              // up to 5×100 messages per channel to find the card

// ───────────────────────────────────────────────────────────────────────────────
// Time helpers
// ───────────────────────────────────────────────────────────────────────────────

function nowZ() {
  return DateTime.now().setZone(config.tzDefault || 'UTC');
}

/** Next occurrence >= now, for any of the ISO weekdays (Mon=1…Sun=7). */
function nextOccurrence(
  now: DateTime,
  days: number[],
  hour: number,
  minute: number
): DateTime {
  const candidates = days.map((d) => {
    let dt = now.set({ weekday: d, hour, minute, second: 0, millisecond: 0 });
    if (dt <= now) dt = dt.plus({ weeks: 1 });
    return dt;
  });
  return candidates.sort((a, b) => a.toMillis() - b.toMillis())[0];
}

/** Previous occurrence <= now (same weekday semantics as above). */
function prevOccurrence(
  now: DateTime,
  days: number[],
  hour: number,
  minute: number
): DateTime {
  const candidates = days.map((d) => {
    let dt = now.set({ weekday: d, hour, minute, second: 0, millisecond: 0 });
    if (dt > now) dt = dt.minus({ weeks: 1 });
    return dt;
  });
  return candidates.sort((a, b) => b.toMillis() - a.toMillis())[0];
}

/** Is now within the window starting at the previous occurrence (durationHours long)? */
function currentWindowOf(
  now: DateTime,
  days: number[],
  hour: number,
  minute: number,
  durationHours: number
): { start: DateTime; end: DateTime } | null {
  const start = prevOccurrence(now, days, hour, minute);
  const end = start.plus({ hours: durationHours });
  if (now >= start && now < end) return { start, end };
  return null;
}

/** Next daily occurrence at hour:minute. */
function nextDaily(now: DateTime, hour: number, minute: number) {
  let dt = now.set({ hour, minute, second: 0, millisecond: 0 });
  if (dt <= now) dt = dt.plus({ days: 1 });
  return dt;
}

/** Next weekly occurrence (ISO weekday 1..7) at hour:minute. */
function nextWeekly(now: DateTime, weekday: number, hour: number, minute: number) {
  let dt = now.set({ weekday, hour, minute, second: 0, millisecond: 0 });
  if (dt <= now) dt = dt.plus({ weeks: 1 });
  return dt;
}

/** Next bi-weekly occurrence from an anchor. */
function nextBiWeeklyFrom(anchor: DateTime, now: DateTime) {
  let dt = anchor;
  while (dt <= now) dt = dt.plus({ weeks: 2 });
  return dt;
}

// Weekly definitions
const HUNT  = { days: [5, 6, 7], hour: 17, minute: 0,  durationH: 14 }; // 17:00 → 07:00 next day
const DANCE = { days: [5],       hour: 18, minute: 30, durationH: 12 }; // 18:30 → 06:30 next day

// Reset definitions (times interpreted in tzDefault)
const DAILY_RESET   = { hour: 8,  minute: 0 };                          // Daily 08:00
const WEEKLY_RESET  = { weekday: 1, hour: 8, minute: 0 };               // Monday 08:00
const VAULT_ANCHOR  = DateTime.fromISO('2025-11-17T05:00:00', { zone: config.tzDefault || 'UTC' }); // Stimen Vaults

// ───────────────────────────────────────────────────────────────────────────────
// Sections for the Hub embed
// ───────────────────────────────────────────────────────────────────────────────

function buildWeeklyLines() {
  const n = nowZ();

  const huntStart  = nextOccurrence(n, HUNT.days, HUNT.hour, HUNT.minute);
  const danceStart = nextOccurrence(n, DANCE.days, DANCE.hour, DANCE.minute);

  const huntUnix  = Math.floor(huntStart.toSeconds());
  const danceUnix = Math.floor(danceStart.toSeconds());

  return [
    '**Weekly schedule**',
    `• ⚔️ **Guild Hunt** — Next start: <t:${huntUnix}:F> — <t:${huntUnix}:R>`,
    `  _(Fri · Sat · Sun)_`,
    `• 💃 **Guild Dance** — Next start: <t:${danceUnix}:F> — <t:${danceUnix}:R>`,
    `  _(Fri → Sat)_`,
  ].join('\n');
}

function buildResetLines() {
  const n = nowZ();

  const dailyNext  = nextDaily(n, DAILY_RESET.hour, DAILY_RESET.minute);
  const weeklyNext = nextWeekly(n, WEEKLY_RESET.weekday, WEEKLY_RESET.hour, WEEKLY_RESET.minute);
  const vaultNext  = nextBiWeeklyFrom(VAULT_ANCHOR, n);

  const dailyUnix  = Math.floor(dailyNext.toSeconds());
  const weeklyUnix = Math.floor(weeklyNext.toSeconds());
  const vaultUnix  = Math.floor(vaultNext.toSeconds());

  return [
    '**Resets**',
    `• 🕕 **Daily Reset** — Next: <t:${dailyUnix}:F> — <t:${dailyUnix}:R>`,
    `• 📅 **Weekly Reset** — Next: <t:${weeklyUnix}:F> — <t:${weeklyUnix}:R>`,
    `• 🏛️ **Stimen Vaults** — Next: <t:${vaultUnix}:F> — <t:${vaultUnix}:R>`,
  ].join('\n');
}

function buildHubEmbed() {
  const desc = [
    'Create or schedule guild activities here.',
    'Click **Create Event** to open the builder. Times render in everyone’s local timezone.',
    '',
    buildWeeklyLines(),
    '',
    buildResetLines(),
  ].join('\n');

  return new EmbedBuilder().setTitle('🛡️ Event Hub').setDescription(desc);
}

function buildHubRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('starter:create')
      .setLabel('Create Event')
      .setStyle(ButtonStyle.Primary),
  );
}

async function postHub(channel: TextChannel) {
  const embed = buildHubEmbed();
  const components = [buildHubRow()];
  const msg = await channel.send({ embeds: [embed], components });

  if (config.eventHubPin) {
    try { await msg.pin(); } catch { /* ignore pin errors */ }
  }

  upsertControlMessage(TYPE, channel.id, msg.id);
  return msg;
}

// ───────────────────────────────────────────────────────────────────────────────
// Auto-refresh scheduler (hub)
// ───────────────────────────────────────────────────────────────────────────────

let hubSchedulerStarted = false;
let nextRefreshTimeout: NodeJS.Timeout | null = null;
let hourlySafetyInterval: NodeJS.Timeout | null = null;

async function refreshHubInPlace(client: Client) {
  const ch = await client.channels.fetch(config.eventChannelId).catch(() => null);
  if (!ch || ch.type !== ChannelType.GuildText) return;
  const channel = ch as TextChannel;

  const existingId = getControlMessage(TYPE, channel.id);
  const existing = existingId ? await channel.messages.fetch(existingId).catch(() => null) : null;

  const embed = buildHubEmbed();
  const components = [buildHubRow()];

  if (!existing) {
    const msg = await channel.send({ embeds: [embed], components });
    if (config.eventHubPin) { try { await msg.pin(); } catch {} }
    upsertControlMessage(TYPE, channel.id, msg.id);
    console.log(`[starter] auto-refresh created Event Hub (${msg.id})`);
    return;
  }

  await existing.edit({ embeds: [embed], components });
  console.log(`[starter] auto-refreshed Event Hub (${existing.id})`);
}

function computeNextRefreshAt() {
  const n = nowZ();

  // Event boundaries
  const nextH = nextOccurrence(n, HUNT.days, HUNT.hour, HUNT.minute);
  const nextD = nextOccurrence(n, DANCE.days, DANCE.hour, DANCE.minute);

  // Reset boundaries
  const nextDailyReset  = nextDaily(n, DAILY_RESET.hour, DAILY_RESET.minute);
  const nextWeeklyReset = nextWeekly(n, WEEKLY_RESET.weekday, WEEKLY_RESET.hour, WEEKLY_RESET.minute);
  const nextVault       = nextBiWeeklyFrom(VAULT_ANCHOR, n);

  const earliest = [nextH, nextD, nextDailyReset, nextWeeklyReset, nextVault]
    .reduce((min, dt) => (dt < min ? dt : min));

  return earliest.plus({ minutes: 1 }); // refresh 1 min after the nearest boundary
}

function scheduleNextAutoRefresh(client: Client) {
  const nextAt = computeNextRefreshAt();
  const n = nowZ();
  const delayMs = Math.max(10_000, nextAt.toMillis() - n.toMillis());

  if (nextRefreshTimeout) clearTimeout(nextRefreshTimeout);
  nextRefreshTimeout = setTimeout(async () => {
    try { await refreshHubInPlace(client); }
    finally { scheduleNextAutoRefresh(client); }
  }, delayMs);

  console.log(`[starter] next auto-refresh at ${nextAt.toISO()} (~${Math.round(delayMs/1000)}s)`);
}

// ───────────────────────────────────────────────────────────────────────────────
// Announcements scheduler (weekly events)
// ───────────────────────────────────────────────────────────────────────────────

let startTimeoutHunt: NodeJS.Timeout | null = null;
let startTimeoutDance: NodeJS.Timeout | null = null;

function annTableEnsure() {
  getDB().prepare(`
    CREATE TABLE IF NOT EXISTS event_announcements (
      kind TEXT NOT NULL,
      startUnix INTEGER NOT NULL,
      endUnix INTEGER NOT NULL,
      channelId TEXT NOT NULL,
      messageId TEXT NOT NULL,
      postedAt INTEGER NOT NULL,
      PRIMARY KEY (kind, startUnix)
    )
  `).run();
}

function getAnnouncement(kind: 'hunt' | 'dance', startUnix: number) {
  return getDB().prepare(
    `SELECT kind, startUnix, endUnix, channelId, messageId, postedAt
     FROM event_announcements WHERE kind = ? AND startUnix = ?`
  ).get(kind, startUnix) as
  | { kind: string; startUnix: number; endUnix: number; channelId: string; messageId: string; postedAt: number }
  | undefined;
}

function saveAnnouncement(kind: 'hunt' | 'dance', startUnix: number, endUnix: number, channelId: string, messageId: string) {
  getDB().prepare(
    `INSERT OR REPLACE INTO event_announcements
     (kind, startUnix, endUnix, channelId, messageId, postedAt)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(kind, startUnix, endUnix, channelId, messageId, Date.now());
}

function removeAnnouncement(kind: 'hunt' | 'dance', startUnix: number) {
  getDB().prepare(`DELETE FROM event_announcements WHERE kind = ? AND startUnix = ?`).run(kind, startUnix);
}

async function postAnnouncement(client: Client, kind: 'hunt' | 'dance', start: DateTime, end: DateTime) {
  const ch = await client.channels.fetch(config.eventChannelId).catch(() => null);
  if (!ch || ch.type !== ChannelType.GuildText) return;
  const channel = ch as TextChannel;

  const endUnix = Math.floor(end.toSeconds());
  const rel = `<t:${endUnix}:R>`;

  const content =
    kind === 'hunt'
      ? `⚔️ @everyone — **Guild Hunt** is open now! Team up for big rewards and support the guild. You have ${rel} left.`
      : `💃 @everyone — **Guild Dance** is open now! Get nice rewards and support guild growth. You have ${rel} left.`;

  const msg = await channel.send({
    content,
    allowedMentions: { parse: ['everyone'] }, // needs permission
  });

  saveAnnouncement(kind, Math.floor(start.toSeconds()), endUnix, channel.id, msg.id);

  // Schedule deletion at end
  const delayMs = Math.max(5_000, end.toMillis() - nowZ().toMillis());
  setTimeout(async () => {
    try {
      const m = await channel.messages.fetch(msg.id).catch(() => null);
      if (m) await m.delete().catch(() => {});
    } finally {
      removeAnnouncement(kind, Math.floor(start.toSeconds()));
    }
  }, delayMs);

  console.log(`[starter] posted ${kind} announcement (${msg.id}); auto-delete in ~${Math.round(delayMs/1000)}s`);
}

async function announcementsSafetyPass(client: Client) {
  const db = getDB();
  const rows = db.prepare(
    `SELECT kind, startUnix, endUnix, channelId, messageId FROM event_announcements`
  ).all() as Array<{kind: 'hunt'|'dance'; startUnix: number; endUnix: number; channelId: string; messageId: string}>;

  const nowSec = Math.floor(Date.now()/1000);

  // Delete expired ones
  for (const r of rows) {
    if (nowSec >= r.endUnix) {
      const ch = await client.channels.fetch(r.channelId).catch(() => null);
      if (ch && ch.type === ChannelType.GuildText) {
        const channel = ch as TextChannel;
        const m = await channel.messages.fetch(r.messageId).catch(() => null);
        if (m) await m.delete().catch(() => {});
      }
      removeAnnouncement(r.kind, r.startUnix);
      console.log(`[starter] cleaned expired ${r.kind} announcement (${r.messageId})`);
    }
  }

  // Only post automatically on startup if we're within ANNOUNCE_GRACE_MIN after start
  const n = nowZ();

  const curH = currentWindowOf(n, HUNT.days, HUNT.hour, HUNT.minute, HUNT.durationH);
  if (curH && n <= curH.start.plus({ minutes: ANNOUNCE_GRACE_MIN })) {
    const startUnix = Math.floor(curH.start.toSeconds());
    if (!getAnnouncement('hunt', startUnix)) {
      await postAnnouncement(client, 'hunt', curH.start, curH.end);
    }
  }

  const curD = currentWindowOf(n, DANCE.days, DANCE.hour, DANCE.minute, DANCE.durationH);
  if (curD && n <= curD.start.plus({ minutes: ANNOUNCE_GRACE_MIN })) {
    const startUnix = Math.floor(curD.start.toSeconds());
    if (!getAnnouncement('dance', startUnix)) {
      await postAnnouncement(client, 'dance', curD.start, curD.end);
    }
  }
}

function scheduleNextStart(client: Client, kind: 'hunt' | 'dance') {
  const n = nowZ();
  const def = kind === 'hunt' ? HUNT : DANCE;
  const nextStart = nextOccurrence(n, def.days, def.hour, def.minute);
  const delayMs = Math.max(10_000, nextStart.toMillis() - n.toMillis());

  const setter = (cb: () => void) => {
    if (kind === 'hunt') {
      if (startTimeoutHunt) clearTimeout(startTimeoutHunt);
      startTimeoutHunt = setTimeout(cb, delayMs);
    } else {
      if (startTimeoutDance) clearTimeout(startTimeoutDance);
      startTimeoutDance = setTimeout(cb, delayMs);
    }
  };

  setter(async () => {
    const start = nextStart;
    const end = start.plus({ hours: def.durationH });
    await postAnnouncement(client, kind, start, end);
    scheduleNextStart(client, kind); // schedule following week
  });

  console.log(`[starter] next ${kind} start at ${nextStart.toISO()} (~${Math.round(delayMs/1000)}s)`);
}

function startAnnouncementsScheduler(client: Client) {
  annTableEnsure();

  // On startup: clean expired + (optionally) post if just started within grace
  announcementsSafetyPass(client).catch(() => {});

  // Schedule next starts
  scheduleNextStart(client, 'hunt');
  scheduleNextStart(client, 'dance');

  console.log('[starter] announcements scheduler started (start timers + safety pass).');
}

// ───────────────────────────────────────────────────────────────────────────────
// Event cards & threads cleanup (NEW)
// ───────────────────────────────────────────────────────────────────────────────

function ensureCleanupTable() {
  getDB().prepare(`
    CREATE TABLE IF NOT EXISTS event_gc (
      eventId TEXT PRIMARY KEY,
      cleanedAt INTEGER NOT NULL
    )
  `).run();
}

function isEventCleaned(eventId: string): boolean {
  const row = getDB().prepare(`SELECT 1 FROM event_gc WHERE eventId = ?`).get(eventId) as any;
  return !!row;
}

function markEventCleaned(eventId: string) {
  getDB().prepare(`INSERT OR REPLACE INTO event_gc (eventId, cleanedAt) VALUES (?, ?)`)
    .run(eventId, Date.now());
}

function messageContainsEventId(msg: Message, eventId: string): boolean {
  if ((msg.content || '').includes(eventId)) return true;

  for (const e of msg.embeds) {
    if ((e.description && e.description.includes(eventId))) return true;
    if (e.footer?.text && e.footer.text.includes(eventId)) return true;
    if (e.fields && e.fields.some(f => (f.value || '').includes(eventId) || (f.name || '').includes(eventId))) return true;
  }

  // Fallback: inspect component customIds
  for (const row of msg.components) {
    for (const comp of row.components as any[]) {
      if (comp.customId && typeof comp.customId === 'string' && comp.customId.includes(eventId)) {
        return true;
      }
    }
  }

  return false;
}

async function deleteEventCardMessages(client: Client, channelId: string, eventId: string): Promise<number> {
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch || ch.type !== ChannelType.GuildText) return 0;
  const channel = ch as TextChannel;

  let before: string | undefined;
  let removed = 0;

  for (let i = 0; i < CLEANUP_SCAN_BATCHES; i++) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || batch.size === 0) break;

    for (const msg of batch.values()) {
      if (msg.author.id !== client.user?.id) continue;
      if (messageContainsEventId(msg, eventId)) {
        await msg.delete().catch(() => {});
        removed++;
      }
    }

    before = batch.last()?.id;
    if (!before) break;
  }

  return removed;
}

async function cleanupOldEventsSweep(client: Client) {
  ensureCleanupTable();

  const db = getDB();
  const nowSec = Math.floor(Date.now() / 1000);
  const cutoff = nowSec - CLEANUP_DELAY_MIN * 60;

  // Find all events older than cutoff and not yet GCed
  const rows = db.prepare(`
    SELECT id, channelId, threadId, whenUnix
    FROM events
    WHERE whenUnix IS NOT NULL
      AND whenUnix < ?
  `).all(cutoff) as Array<{ id: string; channelId: string; threadId: string | null; whenUnix: number }>;

  for (const ev of rows) {
    if (isEventCleaned(ev.id)) continue;

    // 1) Delete thread if exists
    if (ev.threadId) {
      const th = await client.channels.fetch(ev.threadId).catch(() => null);
      if (th && (th.type === ChannelType.PublicThread || th.type === ChannelType.PrivateThread || th.type === ChannelType.AnnouncementThread)) {
        await (th as AnyThreadChannel).delete().catch(() => {});
      }
    }

    // 2) Delete the event card message(s)
    await deleteEventCardMessages(client, ev.channelId, ev.id);

    markEventCleaned(ev.id);
    console.log(`[cleanup] GC’d event ${ev.id} (older than ${CLEANUP_DELAY_MIN}m)`);
  }
}

function startCleanupScheduler(client: Client) {
  // initial sweep
  setTimeout(() => cleanupOldEventsSweep(client).catch(() => {}), 10_000);
  // periodic sweep
  setInterval(() => cleanupOldEventsSweep(client).catch(() => {}), CLEANUP_SWEEP_MIN * 60 * 1000);
  console.log(`[cleanup] event GC scheduler started (every ${CLEANUP_SWEEP_MIN}m, delay ${CLEANUP_DELAY_MIN}m).`);
}

// ───────────────────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────────────────

/** Ensure a hub message exists (create or update in place) and start schedulers. */
export async function ensureStarterMessage(client: Client) {
  if (!hubSchedulerStarted) {
    hubSchedulerStarted = true;
    // kick off hub refresh + boundary refresh + hourly safety
    setTimeout(() => refreshHubInPlace(client).catch(() => {}), 5_000);
    scheduleNextAutoRefresh(client);
    hourlySafetyInterval = setInterval(() => {
      refreshHubInPlace(client).catch(() => {});
      announcementsSafetyPass(client).catch(() => {});
    }, 60 * 60 * 1000);

    // weekly announcements
    startAnnouncementsScheduler(client);

    // old events cleanup
    startCleanupScheduler(client);

    console.log('[starter] schedulers started (hub refresh, announcements, cleanup).');
  }

  // normal ensure logic
  const ch = await client.channels.fetch(config.eventChannelId).catch(() => null);
  if (!ch || ch.type !== ChannelType.GuildText) {
    console.warn('[starter] events channel not found or not text:', config.eventChannelId);
    return;
  }
  const channel = ch as TextChannel;

  const existingId = getControlMessage(TYPE, channel.id);
  const existing = existingId ? await channel.messages.fetch(existingId).catch(() => null) : null;

  const embed = buildHubEmbed();
  const components = [buildHubRow()];

  if (!existing) {
    const msg = await channel.send({ embeds: [embed], components });
    if (config.eventHubPin) { try { await msg.pin(); } catch {} }
    upsertControlMessage(TYPE, channel.id, msg.id);
    console.log(`[starter] created Event Hub in #${channel.name} (${msg.id})`);
    return;
  }

  await existing.edit({ embeds: [embed], components });
  console.log(`[starter] refreshed Event Hub (${existing.id})`);
}

/** Repost the hub so it becomes the latest message. Deletes the previous one. */
export async function bumpStarterMessage(client: Client, force = false) {
  if (!config.eventHubAlwaysLast && !force) return;

  const now = Date.now();
  if (!force && now - lastBumpAt < (config.eventHubBumpCooldownMs || 60000)) return;

  const ch = await client.channels.fetch(config.eventChannelId).catch(() => null);
  if (!ch || ch.type !== ChannelType.GuildText) return;
  const channel = ch as TextChannel;

  const existingId = getControlMessage(TYPE, channel.id);
  const old = existingId ? await channel.messages.fetch(existingId).catch(() => null) : null;

  if (old) { try { await old.delete(); } catch {} }

  await postHub(channel);
  lastBumpAt = now;
  console.log('[starter] bumped Event Hub to bottom.');
}

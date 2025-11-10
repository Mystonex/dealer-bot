import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

type DB = Database.Database;

let db: DB | null = null;

export async function initDB() {
  if (db) return db;

  const dataDir = path.resolve('data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'dealbot.sqlite');
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  // Core tables
  db.prepare(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      guildId TEXT NOT NULL,
      channelId TEXT NOT NULL,
      name TEXT NOT NULL,
      hostId TEXT NOT NULL,
      description TEXT,
      whenUnix INTEGER,
      whenText TEXT,
      max INTEGER,
      threadId TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS participants (
      eventId TEXT NOT NULL,
      userId TEXT NOT NULL,
      PRIMARY KEY (eventId, userId),
      FOREIGN KEY (eventId) REFERENCES events(id) ON DELETE CASCADE
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS control_messages (
      type TEXT NOT NULL,
      channelId TEXT NOT NULL,
      messageId TEXT NOT NULL,
      PRIMARY KEY (type, channelId)
    )
  `).run();

  // Participant reminder tracking
  db.prepare(`
    CREATE TABLE IF NOT EXISTS event_reminders (
      eventId TEXT PRIMARY KEY,
      sent1 INTEGER DEFAULT 0,
      sent2 INTEGER DEFAULT 0,
      sent3 INTEGER DEFAULT 0,
      sent4 INTEGER DEFAULT 0,
      FOREIGN KEY (eventId) REFERENCES events(id) ON DELETE CASCADE
    )
  `).run();

  // NEW: announcements for weekly open/close pings
  db.prepare(`
    CREATE TABLE IF NOT EXISTS event_announcements (
      kind TEXT NOT NULL,              -- 'hunt' | 'dance'
      startUnix INTEGER NOT NULL,      -- window start
      endUnix INTEGER NOT NULL,        -- window end
      channelId TEXT NOT NULL,
      messageId TEXT NOT NULL,
      postedAt INTEGER NOT NULL,
      PRIMARY KEY (kind, startUnix)
    )
  `).run();

  return db;
}

export function getDB(): DB {
  if (!db) throw new Error('DB not initialized. Call initDB() first.');
  return db;
}

export function getControlMessage(type: string, channelId: string): string | undefined {
  const row = getDB()
    .prepare(`SELECT messageId FROM control_messages WHERE type = ? AND channelId = ?`)
    .get(type, channelId) as { messageId: string } | undefined;

  return row?.messageId;
}

export function upsertControlMessage(type: string, channelId: string, messageId: string) {
  getDB()
    .prepare(
      `INSERT INTO control_messages (type, channelId, messageId)
       VALUES (?, ?, ?)
       ON CONFLICT(type, channelId) DO UPDATE SET messageId = excluded.messageId`
    )
    .run(type, channelId, messageId);
}

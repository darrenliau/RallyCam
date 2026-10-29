import * as SQLite from 'expo-sqlite';
export { inOrder } from './inOrder';

let opened: Promise<SQLite.SQLiteDatabase> | null = null;

/** Opens the local database once and creates the tables on first launch. */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  opened ??= open();
  return opened;
}

async function open() {
  const db = await SQLite.openDatabaseAsync('rallycam.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS matches (
      id           TEXT PRIMARY KEY,
      created_at   INTEGER NOT NULL,
      type         TEXT NOT NULL,
      best_of      INTEGER NOT NULL,
      first_server TEXT NOT NULL,
      players      TEXT NOT NULL,
      video_uri    TEXT,
      duration_ms  INTEGER,
      status       TEXT NOT NULL DEFAULT 'live',
      synced_at    INTEGER
    );
    CREATE TABLE IF NOT EXISTS rallies (
      match_id   TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      idx        INTEGER NOT NULL,
      winner     TEXT NOT NULL,
      start_ms   INTEGER,
      end_ms     INTEGER,
      shots      INTEGER,
      confidence REAL,
      source     TEXT NOT NULL,
      PRIMARY KEY (match_id, idx)
    );
  `);
  // Versioned changes after the first release of the schema
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version < 1) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS venues (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        corners      TEXT,
        aspect       REAL,
        last_used_at INTEGER NOT NULL
      );
      ALTER TABLE matches ADD COLUMN venue_id TEXT REFERENCES venues(id) ON DELETE SET NULL;
      PRAGMA user_version = 1;
    `);
  }
  if (version < 2) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS overlays (
        match_id TEXT PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
        data     TEXT NOT NULL
      );
      PRAGMA user_version = 2;
    `);
  }
  if (version < 3) {
    await db.execAsync(`
      ALTER TABLE matches ADD COLUMN overlay_video_uri TEXT;
      PRAGMA user_version = 3;
    `);
  }
  return db;
}

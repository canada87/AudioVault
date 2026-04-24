import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import * as fs from 'fs';
import * as path from 'path';

const dbPath = process.env['DB_PATH'] ?? './data/audiovault.db';

// Ensure directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(dbPath);

// Enable WAL mode and foreign keys
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// Create tables if they don't exist (migrations in production would use drizzle-kit)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_name TEXT NOT NULL,
    display_name TEXT,
    recorded_at INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    audio_deleted INTEGER NOT NULL DEFAULT 0,
    transcription TEXT,
    summary TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    transcribed_at INTEGER,
    processed_at INTEGER,
    duration_seconds INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    parent_id INTEGER REFERENCES tags(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS record_tags (
    record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (record_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS processing_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    triggered_by TEXT NOT NULL,
    status TEXT NOT NULL,
    error_msg TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS daily_limits (
    date TEXT PRIMARY KEY,
    llm_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Idempotent column additions for existing databases
try {
  sqlite.exec(`ALTER TABLE tags ADD COLUMN parent_id INTEGER REFERENCES tags(id) ON DELETE SET NULL`);
} catch (_e) {
  // Column already exists
}

// Create FTS5 virtual table for full-text search
try {
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
      transcription,
      summary,
      content='records',
      content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS records_ai AFTER INSERT ON records BEGIN
      INSERT INTO records_fts(rowid, transcription, summary)
      VALUES (new.id, new.transcription, new.summary);
    END;

    CREATE TRIGGER IF NOT EXISTS records_ad AFTER DELETE ON records BEGIN
      INSERT INTO records_fts(records_fts, rowid, transcription, summary)
      VALUES ('delete', old.id, old.transcription, old.summary);
    END;

    CREATE TRIGGER IF NOT EXISTS records_au AFTER UPDATE ON records BEGIN
      INSERT INTO records_fts(records_fts, rowid, transcription, summary)
      VALUES ('delete', old.id, old.transcription, old.summary);
      INSERT INTO records_fts(rowid, transcription, summary)
      VALUES (new.id, new.transcription, new.summary);
    END;
  `);
} catch (_e) {
  // FTS5 triggers may already exist
}

export const db = drizzle(sqlite, { schema });
export { sqlite };

export default db;

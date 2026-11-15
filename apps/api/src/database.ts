import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

export function openDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const migrations = [
    new URL('../migrations/0001_foundation.sql', import.meta.url),
    new URL('../migrations/0002_accounts.sql', import.meta.url),
  ];
  sqlite.transaction(() => {
    for (const [index, file] of migrations.entries()) {
      const version = index + 1;
      if (!sqlite.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(version)) {
        sqlite.exec(readFileSync(file, 'utf8'));
        sqlite.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
      }
    }
  })();
  return { sqlite, db: drizzle(sqlite) };
}

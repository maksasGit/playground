import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.js';
import { openDatabase } from './database.js';
import { envSchema } from './config.js';

test('health checks the database; other routes stay unavailable', async () => {
  const app = createApp(':memory:');
  try {
    const response = await app.inject('/api/health');
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ok', database: 'ok' });
    assert.equal((await app.inject('/api/vault')).statusCode, 404);
  } finally { await app.close(); }
});

test('migrations are repeatable and data survives reopening with WAL and foreign keys', () => {
  const directory = mkdtempSync(join(tmpdir(), 'playground-'));
  try {
    const path = join(directory, 'test.sqlite');
    const first = openDatabase(path);
    first.sqlite.prepare('INSERT INTO platform_metadata VALUES (?, ?)').run('test', 'persisted');
    first.sqlite.close();
    const second = openDatabase(path);
    try {
      assert.deepEqual(second.sqlite.prepare("SELECT value FROM platform_metadata WHERE key = 'test'").get(), { value: 'persisted' });
      assert.equal(second.sqlite.pragma('journal_mode', { simple: true }), 'wal');
      assert.equal(second.sqlite.pragma('foreign_keys', { simple: true }), 1);
      assert.deepEqual(second.sqlite.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get(), { count: 3 });
    } finally { second.sqlite.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('invalid environment values fail validation', () => {
  assert.equal(envSchema.safeParse({ PORT: '0' }).success, false);
  assert.equal(envSchema.safeParse({ NODE_ENV: 'unknown' }).success, false);
  assert.equal(envSchema.safeParse({ NODE_ENV: 'production' }).success, false);
  assert.equal(envSchema.safeParse({ NODE_ENV: 'production', APP_ORIGIN: 'https://portal.example.test' }).success, true);
});

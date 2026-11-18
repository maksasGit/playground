/* eslint-disable @typescript-eslint/no-require-imports -- These tests exercise the standalone deployment helper. */
/* global require */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Database = require('../../apps/api/node_modules/better-sqlite3');
const { storagePaths, pauseIfIdle } = require('./state.cjs');

test('deployment backup rejects storage outside the persistent data directory', () => {
  const root = path.resolve('fixture');
  const env = { APP_ORIGIN: 'https://portal.example.com' };
  assert.equal(storagePaths(root, env).database, path.join(root, 'data/database/playground.sqlite'));
  for (const value of ['../other.sqlite', './data-other/db', './data/../../outside']) {
    assert.throws(() => storagePaths(root, { ...env, DATABASE_PATH: value }));
    assert.throws(() => storagePaths(root, { ...env, BUILDS_PATH: value }));
  }
  assert.throws(() => storagePaths(root, { APP_ORIGIN: 'http://portal.example.com' }));
});

test('maintenance leaves active/queued builds alone and pauses admission only when idle', () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE build_jobs (status TEXT); CREATE TABLE build_worker (id INTEGER, ready INTEGER); INSERT INTO build_worker VALUES (1, 1)');
    for (const status of ['running', 'queued']) {
      db.prepare('INSERT INTO build_jobs VALUES (?)').run(status);
      assert.equal(pauseIfIdle(db), false);
      assert.equal(db.prepare('SELECT ready FROM build_worker').get().ready, 1);
      db.exec('DELETE FROM build_jobs');
    }
    db.exec("INSERT INTO build_jobs VALUES ('succeeded')");
    assert.equal(pauseIfIdle(db), true);
    assert.equal(db.prepare('SELECT ready FROM build_worker').get().ready, 0);
  } finally { db.close(); }
});

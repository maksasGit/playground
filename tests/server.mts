// Isolated browser-test server: never opens the real Playground database.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../apps/api/src/database.js';
import { createAccount } from '../apps/api/src/accounts.js';
import { createApp } from '../apps/api/src/app.js';

const directory = mkdtempSync(join(tmpdir(), 'playground-browser-'));
const path = join(directory, 'test.sqlite');
const { sqlite } = openDatabase(path);
const owner = await createAccount(sqlite, { username: 'owner', password: 'browser-test-initial-password', role: 'Admin' }, null);
sqlite.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(owner.id);
const editor = await createAccount(sqlite, { username: 'editor', password: 'browser-test-editor-password', role: 'Admin' }, owner.id);
const tester = await createAccount(sqlite, { username: 'project-tester', password: 'browser-test-tester-password', role: 'Tester', displayName: 'Тестер проекта' }, owner.id);
sqlite.prepare('UPDATE users SET must_change_password = 0 WHERE id IN (?, ?)').run(editor.id, tester.id);
sqlite.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(owner.id);
for (const [slug, title] of [['first-game', 'Первая игра'], ['second-game', 'Вторая игра']]) {
  sqlite.prepare('INSERT INTO games (id, slug, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), slug, title, 'Тестируем идеи вместе. <script>window.untrusted = true</script>', Date.now(), Date.now());
}
sqlite.close();
const app = createApp(path, false, { origin: 'http://127.0.0.1:5174', secureCookies: false });
await app.listen({ host: '127.0.0.1', port: 3002 });
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  rmSync(directory, { recursive: true, force: true });
}
process.once('SIGINT', () => { void close(); });
process.once('SIGTERM', () => { void close(); });

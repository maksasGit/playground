// Isolated browser-test server: never opens the real Playground database.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../apps/api/src/database.js';
import { createAccount } from '../apps/api/src/accounts.js';
import { createApp } from '../apps/api/src/app.js';
import { GitHubError, type GitHubReader } from '../apps/api/src/github.js';

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
let githubChecks = 0;
const github: GitHubReader = {
  async inspect(repositoryUrl) {
    if (repositoryUrl !== 'https://github.com/test-team/public-game') throw new GitHubError(422, 'Тестовый репозиторий не найден.');
    githubChecks++;
    return {
      repositoryId: 123, repositoryUrl, sha: (githubChecks === 1 ? 'a' : 'b').repeat(40),
      message: githubChecks === 1 ? 'Initial public main' : 'Updated public main', date: '2026-11-15T12:00:00Z',
    };
  },
};
const app = createApp(path, false, { origin: 'http://127.0.0.1:5174', secureCookies: false }, github);
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

// Isolated browser-test server: never opens the real Playground database.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../apps/api/src/database.js';
import { createAccount } from '../apps/api/src/accounts.js';
import { createApp } from '../apps/api/src/app.js';
import { GitHubError, type GitHubReader } from '../apps/api/src/github.js';
import { createGameServer } from '../apps/api/src/game-server.js';
import { publishRelease, type JobRow } from '../apps/api/src/builds.js';
import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

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
const storage = join(directory, 'builds');
sqlite.prepare("INSERT INTO build_worker (id, owner, heartbeat, ready, message) VALUES (1, 'test-fixture', ?, 1, 'Тестовый сборщик готов.')").run(Date.now());
if (process.env.PLAYWRIGHT_REAL_GAME === '1') {
  const artifactRoot = fileURLToPath(new URL('../data/m4-smoke', import.meta.url));
  const result = JSON.parse(await readFile(join(artifactRoot, 'result.json'), 'utf8'));
  const gameId = randomUUID(); const releaseId = randomUUID();
  await mkdir(join(storage, 'releases'), { recursive: true });
  await cp(join(artifactRoot, 'releases', result.id), join(storage, 'releases', releaseId), { recursive: true });
  sqlite.prepare('INSERT INTO games (id, slug, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(gameId, 'real-needle', 'Needle — real container build', 'Real immutable Docker-built game', Date.now(), Date.now());
  sqlite.prepare('INSERT INTO releases (id, game_id, commit_sha, repository_url, files_json, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(releaseId, gameId, result.snapshot.sha, result.snapshot.repositoryUrl, JSON.stringify(result.files), result.size, Date.now());
  sqlite.prepare('UPDATE games SET active_release_id = ?, deployed_commit_sha = ? WHERE id = ?').run(releaseId, result.snapshot.sha, gameId);
}
let githubChecks = 0;
const github: GitHubReader = {
  async inspect(repositoryUrl) {
    if (repositoryUrl === 'https://github.com/build-team/public-game') return { repositoryId: 321, repositoryUrl, sha: 'c'.repeat(40), message: 'Build fixture', date: '2026-11-15T12:00:00Z' };
    if (repositoryUrl !== 'https://github.com/test-team/public-game') throw new GitHubError(422, 'Тестовый репозиторий не найден.');
    githubChecks++;
    return {
      repositoryId: 123, repositoryUrl, sha: (githubChecks === 1 ? 'a' : 'b').repeat(40),
      message: githubChecks === 1 ? 'Initial public main' : 'Updated public main', date: '2026-11-15T12:00:00Z',
    };
  },
};
const app = createApp(path, false, { origin: 'http://127.0.0.1:5174', secureCookies: false }, github, { storage, gameOrigin: 'http://127.0.0.2:3004' });
const games = createGameServer(path, storage, 'http://127.0.0.1:5174', 'http://127.0.0.2:3004');
await app.listen({ host: '127.0.0.1', port: 3002 });
await games.listen({ host: '127.0.0.2', port: 3004 });
let processing = false;
const worker = setInterval(() => {
  sqlite.prepare('UPDATE build_worker SET heartbeat = ? WHERE id = 1').run(Date.now());
  if (processing) return;
  const job = sqlite.prepare("SELECT * FROM build_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1").get() as JobRow | undefined;
  if (!job) return;
  processing = true;
  void (async () => {
    sqlite.prepare("UPDATE build_jobs SET status = 'running', logs = 'Fixture build started' WHERE id = ?").run(job.id);
    await new Promise(resolve => setTimeout(resolve, 300));
    if (job.build_root === 'broken-project') { sqlite.prepare("UPDATE build_jobs SET status = 'failed', error = 'Fixture build failed; previous release preserved' WHERE id = ?").run(job.id); return; }
    const html = '<!doctype html><html><body><canvas id="game" width="400" height="200"></canvas><script src="./main.js"></script></body></html>';
    const js = "document.querySelector('canvas').getContext('2d').fillRect(0,0,400,200); document.body.dataset.running='yes';";
    const destination = join(storage, 'releases', job.id); await mkdir(destination, { recursive: true });
    await writeFile(join(destination, 'index.html'), html); await writeFile(join(destination, 'main.js'), js);
    publishRelease(sqlite, job, { 'index.html': { size: html.length, mime: 'text/html' }, 'main.js': { size: js.length, mime: 'text/javascript' } }, html.length + js.length);
  })().finally(() => { processing = false; });
}, 200);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  clearInterval(worker);
  await games.close();
  await app.close();
  sqlite.close();
  rmSync(directory, { recursive: true, force: true });
}
process.once('SIGINT', () => { void close(); });
process.once('SIGTERM', () => { void close(); });

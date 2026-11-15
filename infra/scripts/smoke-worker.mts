// Explicit real worker integration check, with its own accounts/database/storage.
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../apps/api/src/database.js';
import { createAccount } from '../../apps/api/src/accounts.js';
import { PublicGitHubClient } from '../../apps/api/src/github.js';
import { createApp } from '../../apps/api/src/app.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = join(root, 'data', `worker-smoke-${randomUUID()}`); await mkdir(directory, { recursive: true });
const path = join(directory, 'db.sqlite'); const storage = join(directory, 'builds'); const { sqlite } = openDatabase(path);
const password = randomBytes(24).toString('hex');
const user = await createAccount(sqlite, { username: 'smoke-owner', password, role: 'Admin' }, null);
sqlite.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(user.id);
const snapshot = await new PublicGitHubClient().inspect('https://github.com/maksasGit/needle');
const gameId = randomUUID();
sqlite.prepare('INSERT INTO games (id, slug, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(gameId, 'needle', 'Worker smoke', Date.now(), Date.now());
sqlite.prepare('INSERT INTO game_repositories (game_id, connection_id, repository_id, repository_url, latest_commit_sha, commit_message, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run(gameId, randomUUID(), snapshot.repositoryId, snapshot.repositoryUrl, snapshot.sha, snapshot.message, Date.now());
const child = spawn(process.execPath, [join(root, 'apps/api/node_modules/tsx/dist/cli.mjs'), join(root, 'apps/api/src/worker.ts')], {
  cwd: root, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, DATABASE_PATH: path, BUILDS_PATH: storage, NODE_ENV: 'development' },
});
child.stdout.on('data', text => process.stdout.write(text)); child.stderr.on('data', text => process.stderr.write(text));
const app = createApp(path, false, undefined, undefined, { storage, gameOrigin: 'http://127.0.0.2:3003' });
try {
  const deadline = Date.now() + 120_000;
  while (!sqlite.prepare('SELECT 1 FROM build_worker WHERE ready = 1').get()) { if (Date.now() > deadline) throw new Error('Worker readiness timed out'); await new Promise(resolve => setTimeout(resolve, 500)); }
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-playground-request': '1' }, payload: { username: 'smoke-owner', password } });
  const session = login.json(); const cookie = String(login.headers['set-cookie']).split(';')[0];
  const queued = await app.inject({ method: 'POST', url: `/api/admin/games/${gameId}/builds`, headers: { cookie, 'x-playground-request': '1', 'x-csrf-token': session.csrfToken }, payload: { buildRoot: '.', commitSha: snapshot.sha } });
  if (queued.statusCode !== 202) throw new Error(queued.body);
  const { jobId } = queued.json();
  let printed = 0;
  while (true) {
    const row = sqlite.prepare('SELECT * FROM build_jobs WHERE id = ?').get(jobId) as { status: string; logs: string; error: string | null };
    process.stdout.write(row.logs.slice(printed)); printed = row.logs.length;
    if (row.status === 'failed') throw new Error(row.error ?? 'Build failed');
    if (row.status === 'succeeded') {
      await access(join(storage, 'releases', jobId, 'index.html'));
      const active = sqlite.prepare('SELECT active_release_id FROM games WHERE id = ?').get(gameId) as { active_release_id: string };
      if (active.active_release_id !== jobId) throw new Error('Publication pointer mismatch');
      console.log('Real API -> durable queue -> worker -> Docker -> immutable publication verified.'); break;
    }
    if (Date.now() > deadline) throw new Error('Worker integration check timed out');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
} finally { child.kill(); await app.close(); sqlite.close(); }

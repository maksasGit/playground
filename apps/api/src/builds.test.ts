import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Game, Session } from '@playground/shared';
import { createApp } from './app.js';
import { openDatabase } from './database.js';
import { createAccount } from './accounts.js';
import { acquireWorkerLease, recoverInterruptedJobs, publishRelease, type JobRow } from './builds.js';
import { createGameServer } from './game-server.js';

const browser = { origin: 'http://127.0.0.1:5173', 'x-playground-request': '1' };
interface Client extends Session { cookie: string }
const headers = (client: Client) => ({ ...browser, cookie: client.cookie, 'x-csrf-token': client.csrfToken });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'playground-build-')); const path = join(directory, 'db.sqlite'); const storage = join(directory, 'builds');
  const { sqlite } = openDatabase(path); const password = 'build-test-password';
  const owner = await createAccount(sqlite, { username: 'owner', password, role: 'Admin' }, null);
  sqlite.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(owner.id);
  for (const role of ['Tester', 'Viewer'] as const) { const user = await createAccount(sqlite, { username: role.toLowerCase(), password, role }, owner.id); sqlite.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(user.id); }
  const app = createApp(path, false, undefined, undefined, { storage, gameOrigin: 'http://127.0.0.2:3003' });
  const login = async (username: string): Promise<Client> => { const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: browser, payload: { username, password } }); assert.equal(response.statusCode, 200); return { ...response.json<Session>(), cookie: String(response.headers['set-cookie']).split(';')[0] }; };
  const admin = await login('owner'); const tester = await login('tester'); const viewer = await login('viewer');
  const response = await app.inject({ method: 'POST', url: '/api/admin/games', headers: headers(admin), payload: { title: 'Build game', slug: 'build-game' } }); const game = response.json<{ game: Game }>().game;
  const connection = randomUUID();
  sqlite.prepare('INSERT INTO game_repositories (game_id, connection_id, repository_id, repository_url, latest_commit_sha, commit_message, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(game.id, connection, 123, 'https://github.com/team/game', 'a'.repeat(40), 'test', Date.now());
  acquireWorkerLease(sqlite, 'test-worker'); sqlite.prepare('UPDATE build_worker SET ready = 1').run();
  const games = createGameServer(path, storage, browser.origin, 'http://127.0.0.2:3003');
  const queue = (client = admin, payload = { buildRoot: '.', commitSha: 'a'.repeat(40) }) => app.inject({ method: 'POST', url: `/api/admin/games/${game.id}/builds`, headers: headers(client), payload });
  async function publish() {
    const queued = await queue(); assert.equal(queued.statusCode, 202, queued.body); const id = queued.json<{ jobId: string }>().jobId;
    sqlite.prepare("UPDATE build_jobs SET status = 'running' WHERE id = ?").run(id);
    const folder = join(storage, 'releases', id); await mkdir(folder, { recursive: true }); await writeFile(join(folder, 'index.html'), '<canvas>game</canvas>');
    publishRelease(sqlite, sqlite.prepare('SELECT * FROM build_jobs WHERE id = ?').get(id) as JobRow, { 'index.html': { size: 21, mime: 'text/html' } }, 21);
    return id;
  }
  return { app, sqlite, admin, tester, viewer, game, games, queue, publish, async close() { await games.close(); await app.close(); sqlite.close(); await rm(directory, { recursive: true, force: true }); } };
}

test('build queue checks role, CSRF, worker readiness, paths, immutable SHA and duplicate requests', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.queue(f.tester)).statusCode, 403); assert.equal((await f.queue(f.viewer)).statusCode, 403);
    assert.equal((await f.queue(f.admin, { buildRoot: '../outside', commitSha: 'a'.repeat(40) })).statusCode, 400);
    assert.equal((await f.queue(f.admin, { buildRoot: '.', commitSha: 'b'.repeat(40) })).statusCode, 409);
    f.sqlite.prepare('UPDATE build_worker SET ready = 0').run(); assert.equal((await f.queue()).statusCode, 409);
    f.sqlite.prepare('UPDATE build_worker SET ready = 1').run();
    // Per-route rate limit starts a separate IP for the remaining checks.
    const queued = await f.app.inject({ method: 'POST', url: `/api/admin/games/${f.game.id}/builds`, headers: headers(f.admin), remoteAddress: '127.0.0.3', payload: { buildRoot: '.', commitSha: 'a'.repeat(40) } });
    assert.equal(queued.statusCode, 202);
    assert.equal((await f.app.inject({ method: 'POST', url: `/api/admin/games/${f.game.id}/builds`, headers: headers(f.admin), remoteAddress: '127.0.0.3', payload: { buildRoot: '.', commitSha: 'a'.repeat(40) } })).statusCode, 409);
    const row = f.sqlite.prepare('SELECT commit_sha FROM build_jobs').get() as { commit_sha: string }; assert.equal(row.commit_sha, 'a'.repeat(40));
  } finally { await f.close(); }
});

test('publication is atomic; failure, recovery and rollback preserve previous releases and comments', async () => {
  const f = await fixture();
  try {
    const first = await f.publish();
    await f.app.inject({ method: 'POST', url: '/api/games/build-game/comments', headers: headers(f.admin), payload: { body: 'Keep this discussion' } });
    const second = await f.publish(); assert.notEqual(first, second);
    const queued = await f.queue(); const jobId = queued.json<{ jobId: string }>().jobId;
    f.sqlite.prepare("UPDATE build_jobs SET status = 'running' WHERE id = ?").run(jobId);
    f.sqlite.prepare('DELETE FROM game_repositories WHERE game_id = ?').run(f.game.id);
    assert.throws(() => publishRelease(f.sqlite, f.sqlite.prepare('SELECT * FROM build_jobs WHERE id = ?').get(jobId) as JobRow, {}, 0), /cancelled/);
    recoverInterruptedJobs(f.sqlite);
    assert.deepEqual(f.sqlite.prepare('SELECT active_release_id FROM games WHERE id = ?').get(f.game.id), { active_release_id: second });
    const rollback = await f.app.inject({ method: 'POST', url: `/api/admin/games/${f.game.id}/rollback`, headers: headers(f.admin), payload: { releaseId: first } }); assert.equal(rollback.statusCode, 200);
    assert.deepEqual(f.sqlite.prepare('SELECT active_release_id FROM games WHERE id = ?').get(f.game.id), { active_release_id: first });
    assert.equal((await f.app.inject({ url: '/api/games/build-game/comments', headers: headers(f.admin) })).json<{ total: number }>().total, 1);
    assert.deepEqual(f.sqlite.prepare('SELECT COUNT(*) AS count FROM releases').get(), { count: 2 });
  } finally { await f.close(); }
});

test('play tickets authorize every asset and enforce session revocation, expiry, game grant, host and release scope', async () => {
  const f = await fixture();
  try {
    const release = await f.publish();
    assert.equal((await f.app.inject({ method: 'POST', url: `/api/games/${f.game.id}/play`, headers: headers(f.viewer), payload: {} })).statusCode, 404);
    f.sqlite.prepare('INSERT INTO game_access (user_id, game_id, granted_by, granted_at) VALUES (?, ?, ?, ?)').run(f.viewer.user.id, f.game.id, f.admin.user.id, Date.now());
    const play = await f.app.inject({ method: 'POST', url: `/api/games/${f.game.id}/play`, headers: headers(f.viewer), payload: {} }); assert.equal(play.statusCode, 200);
    const url = new URL(play.json<{ url: string }>().url); const get = (path = url.pathname, host = '127.0.0.2:3003') => f.games.inject({ url: path, headers: { host } });
    assert.equal((await get()).statusCode, 200); assert.match(String((await get()).headers['content-security-policy']), /frame-ancestors http:\/\/127.0.0.1:5173/);
    assert.match(String((await get()).headers['content-security-policy']), /(?:^|;)\s*connect-src 'self' blob:;/);
    assert.equal((await get(url.pathname, '127.0.0.1:3003')).statusCode, 404);
    assert.equal((await get(url.pathname.replace(release, randomUUID()))).statusCode, 404);
    assert.equal((await get(url.pathname.replace('index.html', 'secret.env'))).statusCode, 404);
    f.sqlite.prepare('DELETE FROM game_access WHERE user_id = ?').run(f.viewer.user.id); assert.equal((await get()).statusCode, 404);
    f.sqlite.prepare('INSERT INTO game_access (user_id, game_id, granted_by, granted_at) VALUES (?, ?, ?, ?)').run(f.viewer.user.id, f.game.id, f.admin.user.id, Date.now());
    f.sqlite.prepare('UPDATE play_tickets SET expires_at = ?').run(Date.now() - 1); assert.equal((await get()).statusCode, 404);
    const next = await f.app.inject({ method: 'POST', url: `/api/games/${f.game.id}/play`, headers: headers(f.viewer), payload: {} }); const nextPath = new URL(next.json<{ url: string }>().url).pathname;
    f.sqlite.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ?').run(Date.now(), f.viewer.user.id); assert.equal((await get(nextPath)).statusCode, 404);
  } finally { await f.close(); }
});

test('worker lease excludes a second process and can be reacquired after expiry', async () => {
  const f = await fixture();
  try {
    assert.equal(acquireWorkerLease(f.sqlite, 'second'), false);
    f.sqlite.prepare('UPDATE build_worker SET heartbeat = 0').run(); assert.equal(acquireWorkerLease(f.sqlite, 'second'), true);
    assert.equal((f.sqlite.prepare('SELECT owner FROM build_worker').get() as { owner: string }).owner, 'second');
  } finally { await f.close(); }
});

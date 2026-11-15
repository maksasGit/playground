import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Repository, Session, Game } from '@playground/shared';
import { createApp } from './app.js';
import { createAccount } from './accounts.js';
import { openDatabase } from './database.js';
import { GitHubError, type GitHubReader, type RepositorySnapshot } from './github.js';

const url = 'https://github.com/test-team/public-game';
const snapshot: RepositorySnapshot = { repositoryId: 123, repositoryUrl: url, sha: 'a'.repeat(40), message: 'Initial main', date: '2026-11-15T12:00:00Z' };
const browser = { origin: 'http://127.0.0.1:5173', 'x-playground-request': '1' };
interface Client extends Session { cookie: string }
const headers = (client: Client) => ({ ...browser, cookie: client.cookie, 'x-csrf-token': client.csrfToken });
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'playground-repository-'));
  const path = join(directory, 'test.sqlite'); const { sqlite } = openDatabase(path);
  const password = 'repository-test-password';
  const owner = await createAccount(sqlite, { username: 'owner', password, role: 'Admin' }, null);
  sqlite.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(owner.id);
  const tester = await createAccount(sqlite, { username: 'tester', password, role: 'Tester' }, owner.id);
  sqlite.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(tester.id);
  let calls = 0;
  let inspect: GitHubReader['inspect'] = async () => snapshot;
  const github: GitHubReader = { inspect: async value => { calls++; return inspect(value); } };
  let app = createApp(path, false, undefined, github);
  async function login(username: string): Promise<Client> {
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: browser, payload: { username, password } });
    assert.equal(response.statusCode, 200, response.body);
    return { ...response.json<Session>(), cookie: String(response.headers['set-cookie']).split(';')[0] };
  }
  const admin = await login('owner'); const user = await login('tester');
  const created = await app.inject({ method: 'POST', url: '/api/admin/games', headers: headers(admin), payload: { title: 'Game', slug: 'game' } });
  const game = created.json<{ game: Game }>().game;
  const base = `/api/admin/games/${game.id}/repository`;
  return {
    get app() { return app; }, get calls() { return calls; }, sqlite, admin, user, game, base,
    setInspect(fn: GitHubReader['inspect']) { inspect = fn; },
    connect() { return app.inject({ method: 'PUT', url: base, headers: headers(admin), payload: { repositoryUrl: url } }); },
    check() { return app.inject({ method: 'POST', url: `${base}/check`, headers: headers(admin), payload: {} }); },
    async restart() { await app.close(); app = createApp(path, false, undefined, github); await app.ready(); },
    async close() { await app.close(); sqlite.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}

test('repository routes are Admin-only, CSRF-protected, fixed to main and perform no requests on reads', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.app.inject(f.base)).statusCode, 401);
    for (const method of ['GET', 'PUT', 'DELETE'] as const) assert.equal((await f.app.inject({ method, url: f.base, headers: headers(f.user), ...(method !== 'GET' ? { payload: {} } : {}) })).statusCode, 403);
    assert.equal((await f.app.inject({ method: 'POST', url: `${f.base}/check`, headers: headers(f.user), payload: {} })).statusCode, 403);
    assert.equal((await f.app.inject({ method: 'PUT', url: f.base, headers: { ...browser, cookie: f.admin.cookie }, payload: { repositoryUrl: url } })).statusCode, 403);
    assert.equal((await f.app.inject({ method: 'PUT', url: f.base, headers: headers(f.admin), payload: { repositoryUrl: url, branch: 'develop' } })).statusCode, 400);
    assert.equal((await f.app.inject({ url: f.base, headers: headers(f.admin) })).body, '{"repository":null}');
    assert.equal(f.calls, 0);
    const response = await f.connect(); assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json<{ repository: Repository }>().repository.branch, 'main');
    assert.equal(f.calls, 1);
    for (let i = 0; i < 3; i++) await f.app.inject({ url: f.base, headers: headers(f.admin) });
    assert.equal(f.calls, 1);
  } finally { await f.close(); }
});

test('manual checks persist across restart, compare deployed SHA and preserve prior snapshot on failure', async () => {
  const f = await fixture();
  try {
    const first = await f.connect();
    assert.equal(first.json<{ repository: Repository }>().repository.status, 'not_published');
    f.sqlite.prepare('UPDATE games SET deployed_commit_sha = ? WHERE id = ?').run(snapshot.sha, f.game.id);
    assert.equal((await f.check()).json<{ repository: Repository }>().repository.status, 'up_to_date');
    f.setInspect(async () => ({ ...snapshot, sha: 'b'.repeat(40), message: 'Next main' }));
    const updated = await f.check(); assert.equal(updated.statusCode, 200);
    assert.equal(updated.json<{ repository: Repository }>().repository.status, 'update_available');
    f.setInspect(async () => { throw new GitHubError(503, 'GitHub ограничил запросы.', 120); });
    const failure = await f.check(); assert.equal(failure.statusCode, 503); assert.equal(failure.headers['retry-after'], '120');
    await f.restart();
    const stored = (await f.app.inject({ url: f.base, headers: headers(f.admin) })).json<{ repository: Repository }>().repository;
    assert.equal(stored.latestCommitSha, 'b'.repeat(40)); assert.equal(stored.deployedCommitSha, snapshot.sha);
    assert.equal(stored.status, 'update_available');
    assert.deepEqual(f.sqlite.prepare('SELECT deployed_commit_sha FROM games WHERE id = ?').get(f.game.id), { deployed_commit_sha: snapshot.sha });
  } finally { await f.close(); }
});

test('failed replacement keeps old connection; disconnect and archive preserve game and comments', async () => {
  const f = await fixture();
  try {
    await f.connect();
    f.setInspect(async () => { throw new GitHubError(422, 'В репозитории нет ветки main.'); });
    const replaced = await f.app.inject({ method: 'PUT', url: f.base, headers: headers(f.admin), payload: { repositoryUrl: 'https://github.com/test-team/other' } });
    assert.equal(replaced.statusCode, 422);
    assert.equal((await f.app.inject({ url: f.base, headers: headers(f.admin) })).json<{ repository: Repository }>().repository.repositoryUrl, url);
    const comment = await f.app.inject({ method: 'POST', url: '/api/games/game/comments', headers: headers(f.admin), payload: { body: 'Keep this discussion' } });
    assert.equal(comment.statusCode, 201);
    await f.app.inject({ method: 'POST', url: `/api/admin/games/${f.game.id}/archive`, headers: headers(f.admin), payload: { archived: true } });
    const calls = f.calls;
    assert.equal((await f.check()).statusCode, 409); assert.equal(f.calls, calls);
    await f.app.inject({ method: 'POST', url: `/api/admin/games/${f.game.id}/archive`, headers: headers(f.admin), payload: { archived: false } });
    assert.equal((await f.app.inject({ method: 'DELETE', url: f.base, headers: headers(f.admin), payload: {} })).statusCode, 200);
    assert.deepEqual((await f.app.inject({ url: f.base, headers: headers(f.admin) })).json(), { repository: null });
    assert.equal((await f.check()).statusCode, 409);
    assert.equal((await f.app.inject({ url: '/api/games/game/comments', headers: headers(f.admin) })).json<{ total: number }>().total, 1);
    assert.ok(JSON.stringify(f.sqlite.prepare('SELECT action FROM audit_events').all()).includes('game.repository_disconnect'));
  } finally { await f.close(); }
});

test('in-flight checks cannot overwrite a disconnected repository or apply results after session revocation', async () => {
  const f = await fixture();
  try {
    await f.connect();
    let complete!: (value: RepositorySnapshot) => void;
    let started!: () => void;
    let ready = new Promise<void>(resolve => { started = resolve; });
    f.setInspect(() => { started(); return new Promise(resolve => { complete = resolve; }); });
    const checking = f.check();
    const result = Promise.resolve(checking); await ready;
    await f.app.inject({ method: 'DELETE', url: f.base, headers: headers(f.admin), payload: {} });
    complete({ ...snapshot, sha: 'b'.repeat(40) });
    assert.equal((await result).statusCode, 409);
    f.setInspect(async () => snapshot); await f.connect();
    ready = new Promise<void>(resolve => { started = resolve; });
    f.setInspect(() => { started(); return new Promise(resolve => { complete = resolve; }); });
    const revoked = Promise.resolve(f.check()); await ready;
    f.sqlite.prepare('UPDATE sessions SET revoked_at = ?').run(Date.now());
    complete({ ...snapshot, sha: 'c'.repeat(40) });
    assert.equal((await revoked).statusCode, 403);
    assert.deepEqual(f.sqlite.prepare('SELECT latest_commit_sha FROM game_repositories WHERE game_id = ?').get(f.game.id), { latest_commit_sha: snapshot.sha });
  } finally { await f.close(); }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from './app.js';
import { openDatabase } from './database.js';
import { createAccount } from './accounts.js';
import type { Session, User } from '@playground/shared';
import type { FastifyInstance } from 'fastify';

const initial = 'test-only-initial-password';
const changed = 'test-only-changed-password';
const origin = 'http://127.0.0.1:5173';
const browser = { origin, 'x-playground-request': '1' };
interface Client extends Session { cookie: string }
async function login(app: FastifyInstance, username = 'owner', password = initial): Promise<Client> {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: browser, payload: { username, password } });
  assert.equal(response.statusCode, 200, response.body);
  return { ...response.json<Session>(), cookie: String(response.headers['set-cookie']).split(';')[0] };
}
function headers(client: Client) { return { ...browser, cookie: client.cookie, 'x-csrf-token': client.csrfToken }; }
async function fixture(ready = true, secureCookies = false) {
  const directory = mkdtempSync(join(tmpdir(), 'playground-auth-'));
  const path = join(directory, 'test.sqlite');
  const { sqlite } = openDatabase(path);
  const owner = await createAccount(sqlite, { username: 'owner', password: initial, role: 'Admin' }, null);
  if (ready) sqlite.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(owner.id);
  const app = createApp(path, false, { origin, secureCookies });
  await app.ready();
  return { app, sqlite, owner, async close() { await app.close(); sqlite.close(); rmSync(directory, { recursive: true, force: true }); } };
}
function updateInput(user: User, overrides = {}) {
  return { displayName: user.displayName, role: user.role, status: user.status, gameIds: user.gameIds, vaultPermissions: user.vaultPermissions, ...overrides };
}

test('bootstrap is one-time, passwords are hashed, no public registration or unauthenticated data', async () => {
  const f = await fixture(false);
  try {
    const row = f.sqlite.prepare('SELECT password_hash FROM users WHERE id = ?').get(f.owner.id) as { password_hash: string };
    assert.match(row.password_hash, /^\$argon2id\$/);
    assert.ok(!row.password_hash.includes(initial));
    await assert.rejects(createAccount(f.sqlite, { username: 'second', password: initial, role: 'Admin' }, null), /уже создан/);
    for (const url of ['/api/games', '/api/admin/users']) assert.equal((await f.app.inject(url)).statusCode, 401);
    assert.deepEqual((await f.app.inject('/api/auth/session')).json(), { user: null, setupRequired: false });
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/auth/register', headers: browser, payload: {} })).statusCode, 404);
    for (const url of ['/data/database/playground.sqlite', '/api/vault/file', '/games/secret/assets/private.js', '/api/games/secret/assets/private.js']) {
      assert.equal((await f.app.inject(url)).statusCode, 404);
    }
  } finally { await f.close(); }
});

test('first-login gate, CSRF validation, password rotation and logout invalidate old sessions', async () => {
  const f = await fixture(false);
  try {
    const client = await login(f.app);
    assert.equal(client.user.mustChangePassword, true);
    assert.equal((await f.app.inject({ url: '/api/games', headers: headers(client) })).statusCode, 403);
    const change = { currentPassword: initial, password: changed };
    const noCsrf = await f.app.inject({ method: 'POST', url: '/api/auth/password', headers: { ...browser, cookie: client.cookie }, payload: change });
    assert.equal(noCsrf.statusCode, 403);
    const crossSite = await f.app.inject({ method: 'POST', url: '/api/auth/password', headers: { ...headers(client), origin: 'https://evil.example' }, payload: change });
    assert.equal(crossSite.statusCode, 403);
    const wrong = await f.app.inject({ method: 'POST', url: '/api/auth/password', headers: headers(client), payload: { ...change, currentPassword: 'wrong' } });
    assert.equal(wrong.statusCode, 400);
    const response = await f.app.inject({ method: 'POST', url: '/api/auth/password', headers: headers(client), payload: change });
    assert.equal(response.statusCode, 200, response.body);
    const next: Client = { ...response.json<Session>(), cookie: String(response.headers['set-cookie']).split(';')[0] };
    assert.equal(next.user.mustChangePassword, false);
    assert.notEqual(next.cookie, client.cookie);
    assert.notEqual(next.csrfToken, client.csrfToken);
    assert.equal((await f.app.inject({ url: '/api/games', headers: headers(client) })).statusCode, 401);
    assert.equal((await f.app.inject({ url: '/api/games', headers: headers(next) })).statusCode, 200);
    const stored = f.sqlite.prepare('SELECT token_hash FROM sessions WHERE revoked_at IS NULL').get() as { token_hash: string };
    assert.ok(!next.cookie.includes(stored.token_hash));
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/auth/logout', headers: headers(next), payload: {} })).statusCode, 200);
    assert.equal((await f.app.inject({ url: '/api/games', headers: headers(next) })).statusCode, 401);
  } finally { await f.close(); }
});

test('admin creates users; grants are independent; Tester/Viewer cannot administer; games are deny-by-default', async () => {
  const f = await fixture();
  try {
    const admin = await login(f.app);
    const allowed = randomUUID(); const hidden = randomUUID();
    for (const [id, slug] of [[allowed, 'allowed'], [hidden, 'hidden']]) {
      f.sqlite.prepare('INSERT INTO games (id, slug, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, slug, slug, '<script>alert(1)</script>', Date.now(), Date.now());
    }
    for (const role of ['Tester', 'Viewer'] as const) {
      const created = await f.app.inject({ method: 'POST', url: '/api/admin/users', headers: headers(admin), payload: { username: role.toLowerCase(), password: initial, role, gameIds: [allowed] } });
      assert.equal(created.statusCode, 201, created.body);
      const user = created.json<{ user: User }>().user;
      assert.equal(user.mustChangePassword, true);
      assert.deepEqual(user.vaultPermissions, []);
      assert.ok(!created.body.includes('password_hash'));
      f.sqlite.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(user.id);
      const client = await login(f.app, user.username);
      const library = await f.app.inject({ url: '/api/games', headers: headers(client) });
      const games = library.json<{ games: { slug: string; canComment: boolean }[] }>().games;
      assert.deepEqual(games.map(game => game.slug), ['allowed']);
      assert.equal(games[0].canComment, role === 'Tester');
      assert.equal((await f.app.inject({ url: '/api/games/hidden', headers: headers(client) })).statusCode, 404);
      assert.equal((await f.app.inject({ url: '/api/games/allowed', headers: headers(client) })).statusCode, 200);
      for (const method of ['GET', 'POST'] as const) assert.equal((await f.app.inject({ method, url: '/api/admin/users', headers: headers(client), ...(method === 'POST' ? { payload: {} } : {}) })).statusCode, 403);
      assert.equal((await f.app.inject({ method: 'POST', url: `/api/admin/users/${admin.user.id}/reset-password`, headers: headers(client), payload: { password: changed } })).statusCode, 403);
      const grants = await f.app.inject({ method: 'PATCH', url: `/api/admin/users/${user.id}`, headers: headers(admin), payload: updateInput(user, { gameIds: [], vaultPermissions: ['vault:read'] }) });
      assert.equal(grants.statusCode, 200);
      assert.deepEqual(grants.json<{ user: User }>().user.vaultPermissions, ['vault:read']);
      assert.deepEqual((await f.app.inject({ url: '/api/games', headers: headers(client) })).json(), { games: [] });
    }
    assert.equal((await f.app.inject({ url: '/api/games', headers: headers(admin) })).json<{ games: unknown[] }>().games.length, 2);
    const duplicate = await f.app.inject({ method: 'POST', url: '/api/admin/users', headers: headers(admin), payload: { username: 'OWNER', password: initial, role: 'Tester' } });
    assert.equal(duplicate.statusCode, 409);
    const badGrant = await f.app.inject({ method: 'POST', url: '/api/admin/users', headers: headers(admin), payload: { username: 'badgrant', password: initial, role: 'Tester', gameIds: [randomUUID()] } });
    assert.equal(badGrant.statusCode, 400);
    assert.equal(f.sqlite.prepare("SELECT 1 FROM users WHERE username = 'badgrant'").get(), undefined);
  } finally { await f.close(); }
});

test('last active admin is protected, including competing demotions', async () => {
  const f = await fixture();
  try {
    const admin = await login(f.app);
    for (const changes of [{ role: 'Tester' }, { status: 'disabled' }]) {
      assert.equal((await f.app.inject({ method: 'PATCH', url: `/api/admin/users/${admin.user.id}`, headers: headers(admin), payload: updateInput(admin.user, changes) })).statusCode, 409);
    }
    const second = await createAccount(f.sqlite, { username: 'another', password: initial, role: 'Admin' }, admin.user.id);
    f.sqlite.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(second.id);
    const other = await login(f.app, 'another');
    const responses = await Promise.all([admin, other].map(client => f.app.inject({ method: 'PATCH', url: `/api/admin/users/${client.user.id}`, headers: headers(client), payload: updateInput(client.user, { role: 'Tester' }) })));
    assert.deepEqual(responses.map(response => response.statusCode).sort(), [200, 409]);
    assert.deepEqual(f.sqlite.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'Admin' AND status = 'active'").get(), { count: 1 });
  } finally { await f.close(); }
});

test('disable/reset/revoke invalidate sessions and audit never stores passwords or tokens', async () => {
  const f = await fixture();
  try {
    const admin = await login(f.app);
    const user = await createAccount(f.sqlite, { username: 'tester', password: initial, role: 'Tester' }, admin.user.id);
    f.sqlite.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(user.id);
    const first = await login(f.app, 'tester');
    const update = (overrides: object) => f.app.inject({ method: 'PATCH', url: `/api/admin/users/${user.id}`, headers: headers(admin), payload: updateInput(user, overrides) });
    assert.equal((await update({ status: 'disabled' })).statusCode, 200);
    assert.equal((await f.app.inject({ url: '/api/games', headers: headers(first) })).statusCode, 401);
    const disabled = await f.app.inject({ method: 'POST', url: '/api/auth/login', headers: browser, payload: { username: 'tester', password: initial } });
    const unknown = await f.app.inject({ method: 'POST', url: '/api/auth/login', headers: browser, payload: { username: 'nobody', password: initial } });
    assert.equal(disabled.statusCode, 401); assert.equal(disabled.body, unknown.body);
    await update({ status: 'active' });
    const second = await login(f.app, 'tester');
    assert.equal((await f.app.inject({ method: 'POST', url: `/api/admin/users/${user.id}/reset-password`, headers: headers(admin), payload: { password: changed } })).statusCode, 200);
    assert.equal((await f.app.inject({ url: '/api/games', headers: headers(second) })).statusCode, 401);
    const reset = await login(f.app, 'tester', changed);
    assert.equal(reset.user.mustChangePassword, true);
    assert.equal((await f.app.inject({ url: '/api/games', headers: headers(reset) })).statusCode, 403);
    assert.equal((await f.app.inject({ method: 'POST', url: `/api/admin/users/${user.id}/revoke-sessions`, headers: headers(admin), payload: {} })).statusCode, 200);
    assert.equal((await f.app.inject({ url: '/api/games', headers: headers(reset) })).statusCode, 401);
    const audit = JSON.stringify(f.sqlite.prepare('SELECT * FROM audit_events').all());
    for (const secret of [initial, changed, first.cookie.split('=')[1], first.csrfToken]) assert.ok(!audit.includes(secret));
    for (const action of ['user.create', 'user.update', 'user.password_reset', 'user.sessions_revoke']) assert.ok(audit.includes(action));
  } finally { await f.close(); }
});

test('session expiry is enforced and production cookies are Secure, HttpOnly, SameSite Strict, host-only', async () => {
  const f = await fixture(true, true);
  try {
    const response = await f.app.inject({ method: 'POST', url: '/api/auth/login', headers: browser, payload: { username: 'owner', password: initial } });
    assert.equal(response.statusCode, 200);
    const setCookie = String(response.headers['set-cookie']);
    for (const flag of ['__Host-playground_session=', 'Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/']) assert.ok(setCookie.includes(flag));
    assert.ok(!setCookie.includes('Domain='));
    const cookie = setCookie.split(';')[0];
    f.sqlite.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1);
    assert.deepEqual((await f.app.inject({ url: '/api/auth/session', headers: { cookie } })).json(), { user: null, setupRequired: false });
  } finally { await f.close(); }
});

test('login rejects form/foreign-origin requests and rate limits repeated attempts', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'owner', password: initial } })).statusCode, 403);
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/auth/login', headers: { ...browser, origin: 'https://evil.example' }, payload: { username: 'owner', password: initial } })).statusCode, 403);
    let limited = false;
    for (let i = 0; i < 12; i++) {
      const response = await f.app.inject({ method: 'POST', url: '/api/auth/login', headers: browser, payload: { username: 'owner', password: 'incorrect-password' } });
      if (response.statusCode === 429) { limited = true; assert.ok(response.headers['retry-after']); break; }
      assert.equal(response.statusCode, 401);
    }
    assert.ok(limited);
  } finally { await f.close(); }
});

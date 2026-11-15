import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { verify } from 'argon2';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { createUserSchema, passwordSchema, updateUserSchema } from '@playground/shared';
import { audit, createAccount, hashPassword, publicUser, setGrants, type UserRow } from './accounts.js';
import { fail, requireUser, requireAdmin } from './access.js';
import { gameRoutes } from './games.js';
export interface AuthOptions { origin: string; secureCookies: boolean }
const SESSION_MS = 12 * 60 * 60 * 1000;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');


export async function accountRoutes(app: FastifyInstance, sqlite: Database.Database, options: AuthOptions) {
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  app.decorateRequest('auth', null);
  const cookieName = options.secureCookies ? '__Host-playground_session' : 'playground_session';
  const cookieOptions = { path: '/', httpOnly: true, secure: options.secureCookies, sameSite: 'strict' as const };
  const dummyHash = await hashPassword(randomBytes(32).toString('hex'));

  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    const token = request.cookies[cookieName];
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const session = sqlite.prepare(`SELECT s.id AS session_id, s.csrf_token, u.* FROM sessions s
        JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.revoked_at IS NULL
        AND s.expires_at > ? AND u.status = 'active'`).get(digest(token), Date.now()) as (UserRow & { session_id: string; csrf_token: string }) | undefined;
      if (session) request.auth = { user: session, sessionId: session.session_id, csrfToken: session.csrf_token };
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      // A custom header forces browser cross-origin fetches through a CORS preflight.
      // CORS is deliberately not enabled. Origins are additionally pinned to configuration.
      if (request.headers['x-playground-request'] !== '1'
        || (request.headers.origin !== undefined && request.headers.origin !== options.origin)
        || request.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Запрос отклонён. Обновите страницу.');
      if (request.auth) {
        const csrf = request.headers['x-csrf-token'];
        const expected = Buffer.from(request.auth.csrfToken);
        if (typeof csrf !== 'string' || Buffer.byteLength(csrf) !== expected.length || !timingSafeEqual(Buffer.from(csrf), expected)) {
          fail(403, 'Сессия страницы устарела. Обновите страницу.');
        }
      }
    }
  });

  function newSession(reply: FastifyReply, user: UserRow) {
    const token = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(32).toString('hex');
    const now = Date.now();
    sqlite.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    sqlite.prepare('INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), user.id, digest(token), csrfToken, now + SESSION_MS, now);
    reply.setCookie(cookieName, token, { ...cookieOptions, maxAge: SESSION_MS / 1000 });
    return { user: publicUser(sqlite, user), csrfToken };
  }
  function revoke(userId: string) {
    sqlite.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(Date.now(), userId);
  }
  function getTarget(id: string) {
    const user = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    if (!user) fail(404, 'Пользователь не найден.');
    return user;
  }

  app.get('/api/auth/session', async request => {
    if (!request.auth) return { user: null, setupRequired: !sqlite.prepare('SELECT 1 FROM users LIMIT 1').get() };
    return { user: publicUser(sqlite, request.auth.user), csrfToken: request.auth.csrfToken };
  });
  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const data = z.object({ username: z.string().trim().min(1).max(128).transform(value => value.toLowerCase()), password: z.string().min(1).max(128) }).strict().parse(request.body);
    const row = sqlite.prepare('SELECT * FROM users WHERE username = ?').get(data.username) as UserRow | undefined;
    const valid = await verify(row?.password_hash ?? dummyHash, data.password);
    // Re-read after asynchronous hashing: disabled/reset accounts must not get a new session.
    const current = row ? sqlite.prepare('SELECT * FROM users WHERE id = ?').get(row.id) as UserRow | undefined : undefined;
    if (!valid || !current || current.status !== 'active' || current.password_hash !== row?.password_hash) {
      audit(sqlite, null, 'auth.login_failed', 'login');
      fail(401, 'Неверное имя пользователя или пароль.');
    }
    if (request.auth) sqlite.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(Date.now(), request.auth.sessionId);
    sqlite.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), current.id);
    audit(sqlite, current.id, 'auth.login', current.id);
    return newSession(reply, current);
  });
  app.post('/api/auth/logout', async (request, reply) => {
    const auth = requireUser(request, true);
    sqlite.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(Date.now(), auth.sessionId);
    audit(sqlite, auth.user.id, 'auth.logout', auth.user.id);
    reply.clearCookie(cookieName, cookieOptions);
    return { ok: true };
  });
  app.post('/api/auth/password', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const auth = requireUser(request, true);
    const data = z.object({ currentPassword: z.string().min(1).max(128), password: passwordSchema }).strict().parse(request.body);
    if (data.currentPassword === data.password) fail(400, 'Новый пароль должен отличаться от текущего.');
    if (!await verify(auth.user.password_hash, data.currentPassword)) fail(400, 'Текущий пароль неверен.');
    const hash = await hashPassword(data.password);
    return sqlite.transaction(() => {
      const current = getTarget(auth.user.id);
      const live = sqlite.prepare('SELECT 1 FROM sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > ?').get(auth.sessionId, Date.now());
      if (!live || current.status !== 'active' || current.password_hash !== auth.user.password_hash) fail(401, 'Войдите в аккаунт заново.');
      sqlite.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?').run(hash, Date.now(), current.id);
      revoke(current.id);
      audit(sqlite, current.id, 'auth.password_change', current.id);
      return newSession(reply, getTarget(current.id));
    }).immediate();
  });

  app.get('/api/admin/users', async request => {
    requireAdmin(request, sqlite);
    return { users: (sqlite.prepare('SELECT * FROM users ORDER BY created_at, username').all() as UserRow[]).map(row => publicUser(sqlite, row)) };
  });
  app.post('/api/admin/users', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const actor = requireAdmin(request, sqlite);
    const data = createUserSchema.parse(request.body);
    const user = await createAccount(sqlite, data, actor.id, request.auth!.sessionId);
    return reply.code(201).send({ user });
  });
  app.patch('/api/admin/users/:id', async request => {
    const actor = requireAdmin(request, sqlite);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const data = updateUserSchema.parse(request.body);
    return sqlite.transaction(() => {
      const current = getTarget(id);
      if (current.role === 'Admin' && current.status === 'active' && (data.role !== 'Admin' || data.status !== 'active')) {
        const admins = sqlite.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'Admin' AND status = 'active'").get() as { count: number };
        if (admins.count <= 1) fail(409, 'Нельзя отключить или понизить последнего активного администратора.');
      }
      sqlite.prepare('UPDATE users SET display_name = ?, role = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(data.displayName, data.role, data.status, Date.now(), id);
      setGrants(sqlite, id, actor.id, data.gameIds, data.vaultPermissions);
      if (current.role !== data.role || current.status !== data.status) revoke(id);
      audit(sqlite, actor.id, 'user.update', id, { role: data.role, status: data.status, gameIds: data.gameIds, vaultPermissions: data.vaultPermissions });
      return { user: publicUser(sqlite, getTarget(id)) };
    }).immediate();
  });
  app.post('/api/admin/users/:id/reset-password', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async request => {
    requireAdmin(request, sqlite);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { password } = z.object({ password: passwordSchema }).strict().parse(request.body);
    getTarget(id);
    const hash = await hashPassword(password);
    return sqlite.transaction(() => {
      const actor = requireAdmin(request, sqlite);
      sqlite.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?').run(hash, Date.now(), id);
      revoke(id);
      audit(sqlite, actor.id, 'user.password_reset', id);
      return { ok: true };
    }).immediate();
  });
  app.post('/api/admin/users/:id/revoke-sessions', async request => {
    const actor = requireAdmin(request, sqlite);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    getTarget(id);
    revoke(id);
    audit(sqlite, actor.id, 'user.sessions_revoke', id);
    return { ok: true };
  });

  await gameRoutes(app, sqlite);
}

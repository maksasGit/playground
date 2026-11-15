import type Database from 'better-sqlite3';
import type { FastifyRequest } from 'fastify';
import type { UserRow } from './accounts.js';

interface Auth { user: UserRow; sessionId: string; csrfToken: string }
declare module 'fastify' { interface FastifyRequest { auth: Auth | null } }
export function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}
export function requireUser(request: FastifyRequest, allowPasswordChange = false) {
  if (!request.auth) fail(401, 'Войдите в аккаунт.');
  if (request.auth.user.must_change_password && !allowPasswordChange) fail(403, 'Сначала смените начальный пароль.');
  return request.auth;
}
export function requireAdmin(request: FastifyRequest, sqlite: Database.Database) {
  const auth = requireUser(request);
  const user = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(auth.user.id) as UserRow | undefined;
  const live = sqlite.prepare('SELECT 1 FROM sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > ?').get(auth.sessionId, Date.now());
  if (!live || !user || user.status !== 'active' || user.role !== 'Admin' || user.must_change_password) fail(403, 'Недостаточно прав.');
  return user;
}

import { randomUUID } from 'node:crypto';
import { hash, argon2id } from 'argon2';
import { createUserSchema, type User } from '@playground/shared';
import type Database from 'better-sqlite3';
import type { z } from 'zod';

export interface UserRow {
  id: string; username: string; display_name: string; password_hash: string;
  role: User['role']; status: User['status']; must_change_password: number;
}
export function hashPassword(password: string) {
  return hash(password, { type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
}
export function audit(sqlite: Database.Database, actor: string | null, action: string, target: string, metadata = {}) {
  sqlite.prepare('INSERT INTO audit_events (id, actor_user_id, action, target, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), actor, action, target, Date.now(), JSON.stringify(metadata));
}
export function publicUser(sqlite: Database.Database, row: UserRow): User {
  return {
    id: row.id, username: row.username, displayName: row.display_name,
    role: row.role, status: row.status, mustChangePassword: Boolean(row.must_change_password),
    gameIds: (sqlite.prepare('SELECT game_id FROM game_access WHERE user_id = ?').all(row.id) as { game_id: string }[]).map(item => item.game_id),
    vaultPermissions: (sqlite.prepare('SELECT permission FROM user_permissions WHERE user_id = ?').all(row.id) as { permission: User['vaultPermissions'][number] }[]).map(item => item.permission),
  };
}
export function setGrants(sqlite: Database.Database, id: string, actor: string, gameIds: string[], permissions: User['vaultPermissions']) {
  sqlite.prepare('DELETE FROM game_access WHERE user_id = ?').run(id);
  for (const gameId of new Set(gameIds)) {
    sqlite.prepare('INSERT INTO game_access (user_id, game_id, granted_by, granted_at) VALUES (?, ?, ?, ?)').run(id, gameId, actor, Date.now());
  }
  sqlite.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(id);
  for (const permission of new Set(permissions)) {
    sqlite.prepare('INSERT INTO user_permissions (user_id, permission, granted_by) VALUES (?, ?, ?)').run(id, permission, actor);
  }
}
export async function createAccount(sqlite: Database.Database, input: z.input<typeof createUserSchema>, actor: string | null, sessionId?: string) {
  const data = createUserSchema.parse(input);
  const passwordHash = await hashPassword(data.password);
  return sqlite.transaction(() => {
    if (actor === null && sqlite.prepare('SELECT 1 FROM users LIMIT 1').get()) throw new Error('Первый администратор уже создан. Используйте панель управления.');
    if (actor !== null && !sqlite.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'Admin' AND status = 'active' AND must_change_password = 0").get(actor)) {
      throw Object.assign(new Error('Недостаточно прав.'), { statusCode: 403 });
    }
    if (sessionId && !sqlite.prepare('SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?').get(sessionId, actor, Date.now())) {
      throw Object.assign(new Error('Войдите в аккаунт заново.'), { statusCode: 401 });
    }
    const id = randomUUID();
    const now = Date.now();
    sqlite.prepare('INSERT INTO users (id, username, display_name, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, data.username, data.displayName, passwordHash, data.role, now, now);
    setGrants(sqlite, id, actor ?? id, data.gameIds, data.vaultPermissions);
    audit(sqlite, actor, actor === null ? 'admin.bootstrap' : 'user.create', id, { role: data.role });
    return publicUser(sqlite, sqlite.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow);
  }).immediate();
}

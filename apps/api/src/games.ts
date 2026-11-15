import { createHash, randomUUID } from 'node:crypto';
import multipart from '@fastify/multipart';
import sharp from 'sharp';
import { z } from 'zod';
import { commentInputSchema, gameInputSchema, type Game, type Comment } from '@playground/shared';
import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { audit } from './accounts.js';
import { fail, requireAdmin, requireUser } from './access.js';

interface GameRow {
  id: string; slug: string; title: string; description: string;
  cover: string | null; updated_at: number; archived: number;
  active_release_id: string | null; deployed_commit_sha: string | null;
}
interface CommentRow {
  id: string; game_id: string; author_user_id: string; body: string;
  created_at: number; edited_at: number | null; status: 'visible' | 'hidden';
  display_name: string; username: string;
}
const idParams = z.object({ id: z.string().uuid() });
const slugParams = z.object({ slug: z.string().max(80) });

export async function gameRoutes(app: FastifyInstance, sqlite: Database.Database) {
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 1 } });

  function getById(id: string) {
    const row = sqlite.prepare('SELECT * FROM games WHERE id = ?').get(id) as GameRow | undefined;
    if (!row) fail(404, 'Игра не найдена.');
    return row;
  }
  function accessibleGame(request: FastifyRequest) {
    const { user } = requireUser(request);
    const { slug } = slugParams.parse(request.params);
    const row = sqlite.prepare(`SELECT g.* FROM games g WHERE g.slug = ? AND (? = 'Admin' OR
      (g.archived = 0 AND EXISTS (SELECT 1 FROM game_access a WHERE a.game_id = g.id AND a.user_id = ?)))`)
      .get(slug, user.role, user.id) as GameRow | undefined;
    if (!row) fail(404, 'Игра не найдена или доступ не предоставлен.');
    return row;
  }
  function toGame(row: GameRow, request: FastifyRequest): Game {
    const { user } = requireUser(request);
    return {
      id: row.id, slug: row.slug, title: row.title, description: row.description,
      cover: row.cover ? `/api/games/${encodeURIComponent(row.slug)}/cover?v=${row.cover}` : null,
      updatedAt: row.updated_at, archived: Boolean(row.archived),
      canComment: !row.archived && user.role !== 'Viewer', canModerate: user.role === 'Admin',
      activeReleaseId: row.active_release_id, deployedCommitSha: row.deployed_commit_sha,
    };
  }
  function commentRow(id: string, gameId: string) {
    const row = sqlite.prepare(`SELECT c.*, u.display_name, u.username FROM comments c JOIN users u ON u.id = c.author_user_id
      WHERE c.id = ? AND c.game_id = ?`).get(id, gameId) as CommentRow | undefined;
    if (!row) fail(404, 'Комментарий не найден.');
    return row;
  }
  function toComment(row: CommentRow, request: FastifyRequest, game: GameRow): Comment {
    const { user } = requireUser(request);
    return {
      id: row.id, gameId: row.game_id, authorId: row.author_user_id,
      authorName: row.display_name || row.username, body: row.body,
      createdAt: row.created_at, editedAt: row.edited_at, status: row.status,
      canEdit: user.id === row.author_user_id && user.role !== 'Viewer' && row.status === 'visible' && !game.archived,
    };
  }

  app.get('/api/games', async request => {
    const { user } = requireUser(request);
    const games = sqlite.prepare(`SELECT g.* FROM games g WHERE g.archived = 0 AND (? = 'Admin' OR EXISTS
      (SELECT 1 FROM game_access a WHERE a.game_id = g.id AND a.user_id = ?)) ORDER BY g.updated_at DESC, g.id`)
      .all(user.role, user.id) as GameRow[];
    return { games: games.map(row => toGame(row, request)) };
  });
  app.get('/api/games/:slug', async request => ({ game: toGame(accessibleGame(request), request) }));

  app.get('/api/admin/games', async request => {
    requireAdmin(request, sqlite);
    return { games: (sqlite.prepare('SELECT * FROM games ORDER BY archived, updated_at DESC, id').all() as GameRow[]).map(row => toGame(row, request)) };
  });
  app.post('/api/admin/games', async (request, reply) => {
    const actor = requireAdmin(request, sqlite);
    const data = gameInputSchema.parse(request.body);
    const game = sqlite.transaction(() => {
      const id = randomUUID(); const now = Date.now();
      sqlite.prepare('INSERT INTO games (id, slug, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, data.slug, data.title, data.description, now, now);
      audit(sqlite, actor.id, 'game.create', id);
      return toGame(getById(id), request);
    }).immediate();
    return reply.code(201).send({ game });
  });
  app.patch('/api/admin/games/:id', async request => {
    const actor = requireAdmin(request, sqlite);
    const { id } = idParams.parse(request.params);
    const data = gameInputSchema.parse(request.body);
    return sqlite.transaction(() => {
      getById(id);
      sqlite.prepare('UPDATE games SET slug = ?, title = ?, description = ?, updated_at = ? WHERE id = ?')
        .run(data.slug, data.title, data.description, Date.now(), id);
      audit(sqlite, actor.id, 'game.update', id);
      return { game: toGame(getById(id), request) };
    }).immediate();
  });
  app.post('/api/admin/games/:id/archive', async request => {
    const actor = requireAdmin(request, sqlite);
    const { id } = idParams.parse(request.params);
    const { archived } = z.object({ archived: z.boolean() }).strict().parse(request.body);
    return sqlite.transaction(() => {
      getById(id);
      sqlite.prepare('UPDATE games SET archived = ?, updated_at = ? WHERE id = ?').run(Number(archived), Date.now(), id);
      audit(sqlite, actor.id, archived ? 'game.archive' : 'game.restore', id);
      return { game: toGame(getById(id), request) };
    }).immediate();
  });

  app.get('/api/games/:slug/cover', async (request, reply) => {
    const game = accessibleGame(request);
    const cover = sqlite.prepare('SELECT bytes FROM game_covers WHERE game_id = ?').get(game.id) as { bytes: Buffer } | undefined;
    if (!cover) fail(404, 'Обложка не найдена.');
    return reply.type('image/webp').header('Content-Disposition', 'inline; filename="cover.webp"').send(cover.bytes);
  });
  app.post('/api/admin/games/:id/cover', {
    preHandler: async request => { requireAdmin(request, sqlite); },
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async request => {
    const { id } = idParams.parse(request.params);
    getById(id);
    const formats: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' };
    let buffer: Buffer | undefined;
    let format: string | undefined;
    for await (const part of request.parts()) {
      if (part.type !== 'file') fail(400, 'Отправьте только файл обложки.');
      buffer = await part.toBuffer();
      format = formats[part.mimetype];
      if (!format) fail(400, 'Поддерживаются только PNG, JPEG и WebP.');
    }
    if (!buffer) fail(400, 'Выберите изображение PNG, JPEG или WebP.');
    let bytes: Buffer;
    try {
      const image = sharp(buffer, { limitInputPixels: 16_000_000, failOn: 'warning' });
      const metadata = await image.metadata();
      if (metadata.format !== format || (metadata.pages ?? 1) > 1) fail(400, 'Нужна статическая растровая обложка.');
      bytes = await image.rotate().resize({ width: 1600, height: 900, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
    } catch { fail(400, 'Не удалось прочитать изображение. Выберите статический PNG, JPEG или WebP до 16 мегапикселей.'); }
    if (bytes.length > 2 * 1024 * 1024) fail(400, 'Обложка слишком большая после обработки. Выберите изображение поменьше.');
    return sqlite.transaction(() => {
      const actor = requireAdmin(request, sqlite);
      getById(id);
      sqlite.prepare(`INSERT INTO game_covers (game_id, bytes, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(game_id) DO UPDATE SET bytes = excluded.bytes, updated_at = excluded.updated_at`).run(id, bytes, Date.now());
      sqlite.prepare('UPDATE games SET cover = ?, updated_at = ? WHERE id = ?')
        .run(createHash('sha256').update(bytes).digest('hex'), Date.now(), id);
      audit(sqlite, actor.id, 'game.cover_upload', id);
      return { game: toGame(getById(id), request) };
    }).immediate();
  });
  app.delete('/api/admin/games/:id/cover', async request => {
    const actor = requireAdmin(request, sqlite);
    const { id } = idParams.parse(request.params);
    return sqlite.transaction(() => {
      getById(id);
      sqlite.prepare('DELETE FROM game_covers WHERE game_id = ?').run(id);
      sqlite.prepare('UPDATE games SET cover = NULL, updated_at = ? WHERE id = ?').run(Date.now(), id);
      audit(sqlite, actor.id, 'game.cover_remove', id);
      return { game: toGame(getById(id), request) };
    }).immediate();
  });

  app.get('/api/games/:slug/comments', async request => {
    const game = accessibleGame(request);
    const query = z.object({ offset: z.coerce.number().int().min(0).max(100000).default(0), limit: z.coerce.number().int().min(1).max(50).default(20), includeHidden: z.enum(['0', '1']).default('0') }).strict().parse(request.query);
    const includeHidden = query.includeHidden === '1';
    if (includeHidden) requireAdmin(request, sqlite);
    const count = sqlite.prepare("SELECT COUNT(*) AS count FROM comments WHERE game_id = ? AND (? = 1 OR status = 'visible')").get(game.id, Number(includeHidden)) as { count: number };
    const comments = sqlite.prepare(`SELECT c.*, u.display_name, u.username FROM comments c JOIN users u ON u.id = c.author_user_id
      WHERE c.game_id = ? AND (? = 1 OR c.status = 'visible') ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`)
      .all(game.id, Number(includeHidden), query.limit, query.offset) as CommentRow[];
    return { comments: comments.map(row => toComment(row, request, game)), total: count.count, offset: query.offset, limit: query.limit };
  });
  const commentLimit = app.createRateLimit({ max: 10, timeWindow: '1 minute', keyGenerator: request => requireUser(request).user.id });
  const commentHooks = {
    preHandler: async (request: FastifyRequest, reply: import('fastify').FastifyReply) => {
      const { user } = requireUser(request);
      const game = accessibleGame(request);
      if (user.role === 'Viewer') fail(403, 'Наблюдатели могут только читать комментарии.');
      if (game.archived) fail(409, 'Игра в архиве. Комментарии доступны только для чтения.');
      const result = await commentLimit(request);
      if (!result.isAllowed && result.isExceeded) { reply.header('Retry-After', result.ttlInSeconds); fail(429, 'Слишком много комментариев. Попробуйте позже.'); }
    },
  };
  app.post('/api/games/:slug/comments', commentHooks, async (request, reply) => {
    const game = accessibleGame(request);
    const { user } = requireUser(request);
    const { body } = commentInputSchema.parse(request.body);
    const id = randomUUID();
    sqlite.prepare('INSERT INTO comments (id, game_id, author_user_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(id, game.id, user.id, body, Date.now());
    return reply.code(201).send({ comment: toComment(commentRow(id, game.id), request, game) });
  });
  app.patch('/api/games/:slug/comments/:id', commentHooks, async request => {
    const game = accessibleGame(request);
    const { user } = requireUser(request);
    const { id } = idParams.parse(request.params);
    const { body } = commentInputSchema.parse(request.body);
    const comment = commentRow(id, game.id);
    if (comment.author_user_id !== user.id) fail(403, 'Можно редактировать только свои комментарии.');
    if (comment.status !== 'visible') fail(409, 'Скрытый комментарий нельзя редактировать.');
    sqlite.prepare('UPDATE comments SET body = ?, edited_at = ? WHERE id = ?').run(body, Date.now(), id);
    return { comment: toComment(commentRow(id, game.id), request, game) };
  });
  app.post('/api/games/:slug/comments/:id/moderate', async request => {
    const actor = requireAdmin(request, sqlite);
    const game = accessibleGame(request);
    const { id } = idParams.parse(request.params);
    const { status } = z.object({ status: z.enum(['visible', 'hidden']) }).strict().parse(request.body);
    return sqlite.transaction(() => {
      commentRow(id, game.id);
      sqlite.prepare('UPDATE comments SET status = ?, moderated_at = ?, moderated_by = ? WHERE id = ?').run(status, Date.now(), actor.id, id);
      audit(sqlite, actor.id, `comment.${status === 'hidden' ? 'hide' : 'restore'}`, id, { gameId: game.id });
      return { comment: toComment(commentRow(id, game.id), request, game) };
    }).immediate();
  });
}

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { buildRootSchema, type BuildJob } from '@playground/shared';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { fail, requireAdmin, requireUser } from './access.js';
import { audit } from './accounts.js';

export interface RuntimeOptions { storage: string; gameOrigin: string }
export interface JobRow {
  id: string; game_id: string; actor_id: string; connection_id: string; repository_url: string;
  commit_sha: string; build_root: string; status: BuildJob['status']; release_id: string | null;
  logs: string; error: string | null; created_at: number;
}
export function acquireWorkerLease(sqlite: Database.Database, owner: string) {
  return sqlite.transaction(() => {
    if (sqlite.prepare('SELECT 1 FROM build_worker WHERE id = 1 AND heartbeat > ?').get(Date.now() - 30_000)) return false;
    sqlite.prepare('INSERT INTO build_worker (id, owner, heartbeat, message) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, heartbeat = excluded.heartbeat, ready = 0, message = excluded.message')
      .run(owner, Date.now(), 'Подготавливаем Docker-сборщик…');
    return true;
  }).immediate();
}
export function recoverInterruptedJobs(sqlite: Database.Database) {
  sqlite.prepare("UPDATE build_jobs SET status = 'failed', error = 'Сборка прервана перезапуском worker. Опубликованная версия сохранена.', finished_at = ? WHERE status = 'running'").run(Date.now());
}
export function publishRelease(sqlite: Database.Database, job: JobRow, files: unknown, size: number, workerOwner?: string) {
  sqlite.transaction(() => {
    if (workerOwner && !sqlite.prepare('SELECT 1 FROM build_worker WHERE id = 1 AND owner = ?').get(workerOwner)) throw new Error('Build worker lease was lost');
    const row = sqlite.prepare(`SELECT g.archived, r.connection_id, u.status, u.role, u.must_change_password
      FROM games g LEFT JOIN game_repositories r ON r.game_id = g.id JOIN users u ON u.id = ? WHERE g.id = ?`).get(job.actor_id, job.game_id) as { archived: number; connection_id: string | null; status: string; role: string; must_change_password: number } | undefined;
    const state = sqlite.prepare('SELECT status FROM build_jobs WHERE id = ?').get(job.id) as { status: string } | undefined;
    if (!row || row.archived || row.connection_id !== job.connection_id || row.status !== 'active' || row.role !== 'Admin' || row.must_change_password || state?.status !== 'running') throw new Error('Publication cancelled: game, repository or administrator permissions changed');
    sqlite.prepare('INSERT INTO releases (id, game_id, commit_sha, repository_url, files_json, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(job.id, job.game_id, job.commit_sha, job.repository_url, JSON.stringify(files), size, Date.now());
    sqlite.prepare('UPDATE games SET active_release_id = ?, deployed_commit_sha = ?, updated_at = ? WHERE id = ?').run(job.id, job.commit_sha, Date.now(), job.game_id);
    sqlite.prepare("UPDATE build_jobs SET status = 'succeeded', release_id = ?, finished_at = ? WHERE id = ?").run(job.id, Date.now(), job.id);
    audit(sqlite, job.actor_id, 'game.publish', job.game_id, { releaseId: job.id, commitSha: job.commit_sha });
  }).immediate();
}
export function buildRoutes(app: FastifyInstance, sqlite: Database.Database, runtime: RuntimeOptions) {
  const params = z.object({ id: z.string().uuid() });
  const active = (id: string) => sqlite.prepare("SELECT 1 FROM build_jobs WHERE game_id = ? AND status IN ('queued', 'running')").get(id);
  function getGame(id: string, writable = false) {
    const row = sqlite.prepare('SELECT * FROM games WHERE id = ?').get(id) as { id: string; archived: number; active_release_id: string | null } | undefined;
    if (!row) fail(404, 'Игра не найдена.');
    if (writable && row.archived) fail(409, 'Сначала верните игру из архива.');
    return row;
  }
  app.get('/api/admin/games/:id/builds', async request => {
    requireAdmin(request, sqlite); const { id } = params.parse(request.params); const game = getGame(id);
    const worker = sqlite.prepare('SELECT * FROM build_worker WHERE id = 1').get() as { heartbeat: number; ready: number; message: string } | undefined;
    const alive = !!worker && worker.heartbeat > Date.now() - 30_000;
    const jobs = sqlite.prepare('SELECT * FROM build_jobs WHERE game_id = ? ORDER BY created_at DESC, id DESC LIMIT 5').all(id) as JobRow[];
    const releases = sqlite.prepare('SELECT id, commit_sha, created_at, size FROM releases WHERE game_id = ? ORDER BY created_at DESC, id DESC LIMIT 50').all(id) as { id: string; commit_sha: string; created_at: number; size: number }[];
    return {
      workerReady: alive && Boolean(worker.ready), workerMessage: alive ? worker.message : 'Сборщик не запущен. Запустите pnpm worker или перезапустите pnpm dev.',
      jobs: jobs.map(row => ({ id: row.id, gameId: row.game_id, commitSha: row.commit_sha, buildRoot: row.build_root, status: row.status, releaseId: row.release_id, logs: row.logs, error: row.error, createdAt: row.created_at })),
      releases: releases.map(row => ({ id: row.id, commitSha: row.commit_sha, createdAt: row.created_at, size: row.size, active: row.id === game.active_release_id })),
    };
  });
  app.post('/api/admin/games/:id/builds', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const actor = requireAdmin(request, sqlite); const { id } = params.parse(request.params);
    const { buildRoot, commitSha } = z.object({ buildRoot: buildRootSchema, commitSha: z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/) }).strict().parse(request.body);
    const jobId = sqlite.transaction(() => {
      getGame(id, true); if (active(id)) fail(409, 'Для этой игры уже выполняется сборка.');
      const worker = sqlite.prepare('SELECT 1 FROM build_worker WHERE id = 1 AND ready = 1 AND heartbeat > ?').get(Date.now() - 30_000);
      if (!worker) fail(409, 'Сборщик не готов. Запустите Docker Desktop и pnpm worker.');
      const repository = sqlite.prepare('SELECT * FROM game_repositories WHERE game_id = ?').get(id) as { connection_id: string; repository_url: string; latest_commit_sha: string } | undefined;
      if (!repository) fail(409, 'Сначала подключите репозиторий.');
      if (repository.latest_commit_sha !== commitSha) fail(409, 'Коммит изменился. Обновите сведения о репозитории перед сборкой.');
      const jobId = randomUUID();
      sqlite.prepare("INSERT INTO build_jobs (id, game_id, actor_id, connection_id, repository_url, commit_sha, build_root, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)")
        .run(jobId, id, actor.id, repository.connection_id, repository.repository_url, commitSha, buildRoot, Date.now());
      audit(sqlite, actor.id, 'game.build_queue', id, { jobId, commitSha, buildRoot });
      return jobId;
    }).immediate();
    return reply.code(202).send({ jobId });
  });
  app.post('/api/admin/games/:id/rollback', async request => {
    const actor = requireAdmin(request, sqlite); const { id } = params.parse(request.params);
    const { releaseId } = z.object({ releaseId: z.string().uuid() }).strict().parse(request.body);
    sqlite.transaction(() => {
      getGame(id, true); if (active(id)) fail(409, 'Дождитесь завершения текущей сборки.');
      const release = sqlite.prepare('SELECT commit_sha FROM releases WHERE id = ? AND game_id = ?').get(releaseId, id) as { commit_sha: string } | undefined;
      if (!release) fail(404, 'Версия этой игры не найдена.');
      sqlite.prepare('UPDATE games SET active_release_id = ?, deployed_commit_sha = ?, updated_at = ? WHERE id = ?').run(releaseId, release.commit_sha, Date.now(), id);
      audit(sqlite, actor.id, 'game.rollback', id, { releaseId });
    }).immediate();
    return { ok: true };
  });
  app.post('/api/games/:id/play', async request => {
    const { user, sessionId } = requireUser(request); const { id } = params.parse(request.params);
    const game = getGame(id);
    if (game.archived || (user.role !== 'Admin' && !sqlite.prepare('SELECT 1 FROM game_access WHERE user_id = ? AND game_id = ?').get(user.id, id))) fail(404, 'Игра недоступна.');
    if (!game.active_release_id) fail(409, 'У игры пока нет опубликованной версии.');
    const ticket = randomBytes(32).toString('hex');
    sqlite.prepare('DELETE FROM play_tickets WHERE expires_at <= ?').run(Date.now());
    sqlite.prepare('INSERT INTO play_tickets (token_hash, session_id, user_id, release_id, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(createHash('sha256').update(ticket).digest('hex'), sessionId, user.id, game.active_release_id, Date.now() + 60 * 60_000);
    return { url: `${runtime.gameOrigin}/play/${ticket}/${game.active_release_id}/index.html`, expiresAt: Date.now() + 60 * 60_000 };
  });
}

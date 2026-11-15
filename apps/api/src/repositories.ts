import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { repositoryInputSchema, type Repository } from '@playground/shared';
import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { audit } from './accounts.js';
import { fail, requireAdmin } from './access.js';
import { compareCommits, type GitHubReader } from './github.js';

interface Connection {
  connection_id: string; revision: number; repository_id: number; repository_url: string;
  latest_commit_sha: string; commit_message: string; commit_date: string | null; checked_at: number;
}
export function repositoryRoutes(app: FastifyInstance, sqlite: Database.Database, github: GitHubReader) {
  const params = z.object({ id: z.string().uuid() });
  const connection = (id: string) => sqlite.prepare('SELECT * FROM game_repositories WHERE game_id = ?').get(id) as Connection | undefined;
  function game(id: string, writable = false) {
    const value = sqlite.prepare('SELECT archived, deployed_commit_sha FROM games WHERE id = ?').get(id) as { archived: number; deployed_commit_sha: string | null } | undefined;
    if (!value) fail(404, 'Игра не найдена.');
    if (writable && value.archived) fail(409, 'Сначала верните игру из архива.');
    return value;
  }
  function info(id: string): Repository | null {
    const current = game(id);
    const row = connection(id);
    return row ? {
      repositoryUrl: row.repository_url, branch: 'main', latestCommitSha: row.latest_commit_sha,
      commitMessage: row.commit_message, commitDate: row.commit_date, checkedAt: row.checked_at,
      deployedCommitSha: current.deployed_commit_sha,
      status: compareCommits(row.latest_commit_sha, current.deployed_commit_sha),
    } : null;
  }
  app.get('/api/admin/games/:id/repository', async request => {
    requireAdmin(request, sqlite);
    const { id } = params.parse(request.params);
    return { repository: info(id) };
  });
  const limit = { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } };
  function assertUnchanged(request: FastifyRequest, id: string, before: Connection | undefined) {
    const actor = requireAdmin(request, sqlite);
    game(id, true);
    const current = connection(id);
    if (current?.connection_id !== before?.connection_id || current?.revision !== before?.revision) fail(409, 'Подключение изменилось во время проверки. Обновите страницу и повторите действие.');
    return actor;
  }
  app.put('/api/admin/games/:id/repository', limit, async request => {
    requireAdmin(request, sqlite);
    const { id } = params.parse(request.params);
    game(id, true);
    const { repositoryUrl } = repositoryInputSchema.parse(request.body);
    const before = connection(id);
    const snapshot = await github.inspect(repositoryUrl);
    return sqlite.transaction(() => {
      const actor = assertUnchanged(request, id, before);
      sqlite.prepare(`INSERT INTO game_repositories (game_id, connection_id, revision, repository_id, repository_url, latest_commit_sha, commit_message, commit_date, checked_at)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?) ON CONFLICT(game_id) DO UPDATE SET connection_id = excluded.connection_id,
        revision = 1, repository_id = excluded.repository_id, repository_url = excluded.repository_url,
        latest_commit_sha = excluded.latest_commit_sha, commit_message = excluded.commit_message, commit_date = excluded.commit_date, checked_at = excluded.checked_at`)
        .run(id, randomUUID(), snapshot.repositoryId, snapshot.repositoryUrl, snapshot.sha, snapshot.message, snapshot.date, Date.now());
      audit(sqlite, actor.id, 'game.repository_connect', id, { repositoryUrl: snapshot.repositoryUrl, branch: 'main' });
      return { repository: info(id) };
    }).immediate();
  });
  app.post('/api/admin/games/:id/repository/check', limit, async request => {
    requireAdmin(request, sqlite);
    const { id } = params.parse(request.params);
    game(id, true);
    const before = connection(id);
    if (!before) fail(409, 'Сначала подключите репозиторий.');
    const snapshot = await github.inspect(before.repository_url);
    return sqlite.transaction(() => {
      const actor = assertUnchanged(request, id, before);
      if (snapshot.repositoryId !== before.repository_id) fail(409, 'По этому адресу теперь другой репозиторий. Подключите его заново.');
      sqlite.prepare('UPDATE game_repositories SET revision = revision + 1, latest_commit_sha = ?, commit_message = ?, commit_date = ?, checked_at = ? WHERE game_id = ?')
        .run(snapshot.sha, snapshot.message, snapshot.date, Date.now(), id);
      audit(sqlite, actor.id, 'game.repository_check', id, { commitSha: snapshot.sha });
      return { repository: info(id) };
    }).immediate();
  });
  app.delete('/api/admin/games/:id/repository', async request => {
    const actor = requireAdmin(request, sqlite);
    const { id } = params.parse(request.params);
    game(id, true);
    sqlite.transaction(() => {
      sqlite.prepare('DELETE FROM game_repositories WHERE game_id = ?').run(id);
      audit(sqlite, actor.id, 'game.repository_disconnect', id);
    }).immediate();
    return { repository: null };
  });
}

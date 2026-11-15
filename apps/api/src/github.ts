import { z } from 'zod';
import { commitShaSchema, repositoryUrlSchema, type Repository } from '@playground/shared';

export class GitHubError extends Error {
  constructor(public statusCode: number, message: string, public retryAfter?: number) { super(message); }
}
export interface RepositorySnapshot {
  repositoryId: number; repositoryUrl: string; sha: string; message: string; date: string | null;
}
export interface GitHubReader { inspect(repositoryUrl: string): Promise<RepositorySnapshot> }
export function compareCommits(latest: string | null, deployed: string | null): Repository['status'] {
  if (!latest) return 'not_checked';
  if (!deployed) return 'not_published';
  return latest === deployed ? 'up_to_date' : 'update_available';
}

// Only public GitHub.com metadata is read. No credentials, git commands or repository scripts.
export class PublicGitHubClient implements GitHubReader {
  constructor(private transport: typeof fetch = fetch) {}

  private async read(path: string, missingMessage: string): Promise<unknown> {
    try {
      const response = await this.transport(`https://api.github.com${path}`, {
        method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000),
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Playground', 'X-GitHub-Api-Version': '2026-03-10' },
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 404) throw new GitHubError(422, missingMessage);
        if (response.status === 403 || response.status === 429) {
          const retry = Number(response.headers.get('retry-after'));
          throw new GitHubError(503, 'GitHub ограничил запросы. Попробуйте позже. Без авторизации лимит общий для вашего IP.', Number.isFinite(retry) && retry > 0 ? Math.min(retry, 3600) : undefined);
        }
        if (response.status >= 300 && response.status < 400) throw new GitHubError(422, 'Репозиторий перенесён. Вставьте его актуальную ссылку.');
        throw new GitHubError(502, 'GitHub временно недоступен. Попробуйте ещё раз позже.');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new GitHubError(502, 'GitHub вернул пустой ответ.');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 1024 * 1024) { await reader.cancel(); throw new GitHubError(502, 'Ответ GitHub слишком большой.'); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      if (error instanceof GitHubError) throw error;
      throw new GitHubError(502, 'Не удалось связаться с GitHub. Проверьте интернет и актуальную ссылку на репозиторий.');
    }
  }

  async inspect(input: string): Promise<RepositorySnapshot> {
    const repositoryUrl = repositoryUrlSchema.parse(input);
    const [owner, name] = repositoryUrl.slice('https://github.com/'.length).split('/');
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    const metadata = z.object({ id: z.number().int().positive().safe(), private: z.boolean(), full_name: z.string().max(150) })
      .safeParse(await this.read(path, 'Публичный репозиторий не найден. Проверьте ссылку; приватные репозитории пока не поддерживаются.'));
    if (!metadata.success || metadata.data.private) throw new GitHubError(422, 'Нужен доступный публичный репозиторий GitHub.');
    const canonical = repositoryUrlSchema.safeParse(`https://github.com/${metadata.data.full_name}`);
    if (!canonical.success || canonical.data.toLowerCase() !== repositoryUrl.toLowerCase()) throw new GitHubError(422, 'Репозиторий переименован. Вставьте актуальную ссылку GitHub.');
    const branch = z.object({
      name: z.literal('main'),
      commit: z.object({ sha: commitShaSchema, commit: z.object({ message: z.string().max(100_000), committer: z.object({ date: z.string().datetime({ offset: true }) }).nullable() }) }),
    }).safeParse(await this.read(`${path}/branches/main`, 'В репозитории нет ветки main или она пока не содержит коммитов.'));
    if (!branch.success) throw new GitHubError(502, 'GitHub вернул некорректные сведения о ветке main.');
    return {
      repositoryId: metadata.data.id, repositoryUrl: canonical.data, sha: branch.data.commit.sha,
      message: branch.data.commit.commit.message.split(/\r?\n/, 1)[0].slice(0, 500),
      date: branch.data.commit.commit.committer?.date ?? null,
    };
  }
}

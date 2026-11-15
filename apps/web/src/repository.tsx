import { useEffect, useState, type FormEvent } from 'react';
import { repositoryInputSchema, repositorySchema, type Repository } from '@playground/shared';
import { z } from 'zod';
import { api } from './api';
import { Feedback, Field, useAction } from './forms';

const responseSchema = z.object({ repository: repositorySchema.nullable() });
const statusLabels: Record<Repository['status'], string> = {
  not_checked: 'Ещё не проверено', not_published: 'Версия найдена · ещё не опубликована',
  up_to_date: 'Опубликована последняя версия', update_available: 'Есть обновление в main',
};
export function RepositoryPanel({ gameId, archived }: { gameId: string; archived: boolean }) {
  const [repository, setRepository] = useState<Repository | null>(null);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const action = useAction();
  const base = `/admin/games/${gameId}/repository`;
  useEffect(() => { const refresh = () => setRetry(value => value + 1); window.addEventListener('release-changed', refresh); return () => window.removeEventListener('release-changed', refresh); }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError('');
    api(base).then(data => {
      if (!active) return;
      const value = responseSchema.parse(data).repository;
      setRepository(value); setUrl(value?.repositoryUrl ?? '');
    }).catch(error => { if (active) setLoadError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [base, retry]);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await action.run(async () => {
      const input = repositoryInputSchema.safeParse({ repositoryUrl: url });
      if (!input.success) throw new Error(input.error.issues[0].message);
      const value = responseSchema.parse(await api(base, 'PUT', input.data)).repository;
      setRepository(value); setUrl(value?.repositoryUrl ?? ''); action.setNotice('Репозиторий подключён. Ветка main проверена.');
    });
  }
  return <section className="repository-panel" aria-labelledby={`repo-${gameId}`}>
    <div className="section-heading"><h3 id={`repo-${gameId}`}>Исходники на GitHub</h3><span className="pill">Ветка: main</span></div>
    <p className="fine-print">Публичный репозиторий. Обновления проверяются только по кнопке. Подключение не запускает сборку.</p>
    {loading ? <p className="muted" role="status">Загружаем подключение…</p> : loadError ? <><Feedback error={loadError} /><button onClick={() => setRetry(value => value + 1)}>Повторить загрузку подключения</button></> : <>
      <form onSubmit={connect}><fieldset disabled={action.busy || archived}>
        <Field label="Ссылка на GitHub"><input type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://github.com/owner/game" required maxLength={250} /><small>Ссылка на сам репозиторий. Всегда используется main; ключи и токены не нужны.</small></Field>
        <button type="submit">{action.busy ? 'Обращаемся к GitHub…' : repository ? 'Сохранить репозиторий' : 'Подключить репозиторий'}</button>
      </fieldset></form>
      {repository && <div className="repository-status"><span className="pill">{statusLabels[repository.status]}</span>
        <dl><div><dt>Репозиторий</dt><dd><a href={repository.repositoryUrl} target="_blank" rel="noopener noreferrer">{repository.repositoryUrl.replace('https://github.com/', '')} ↗</a></dd></div>
          <div><dt>Последний коммит main</dt><dd>{repository.latestCommitSha ? <a href={`${repository.repositoryUrl}/commit/${repository.latestCommitSha}`} target="_blank" rel="noopener noreferrer"><code>{repository.latestCommitSha.slice(0, 12)}</code> ↗</a> : 'Не проверено'}</dd></div>
          <div><dt>Опубликованный коммит</dt><dd><code>{repository.deployedCommitSha?.slice(0, 12) ?? 'Пока нет'}</code></dd></div>
          {repository.checkedAt && <div><dt>Проверено</dt><dd>{new Date(repository.checkedAt).toLocaleString('ru')}</dd></div>}
        </dl>{repository.commitMessage && <p className="commit-message">{repository.commitMessage}</p>}
        <div className="button-row"><button className="primary" disabled={action.busy || archived} onClick={() => void action.run(async () => {
          const value = responseSchema.parse(await api(`${base}/check`, 'POST', {})).repository;
          setRepository(value); action.setNotice('Проверка main завершена. Публикация не запускалась.');
        })}>{action.busy ? 'Проверяем…' : 'Проверить обновления'}</button><button disabled={action.busy || archived} onClick={() => void action.run(async () => {
          await api(base, 'DELETE', {}); setRepository(null); setUrl(''); action.setNotice('Репозиторий отключён. Карточка и комментарии сохранены.');
        })}>Отключить репозиторий</button></div>
      </div>}
      {archived && <p className="fine-print">Для изменения подключения или проверки обновлений верните игру из архива.</p>}
      <Feedback {...action} />
    </>}
  </section>;
}

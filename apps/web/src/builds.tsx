import { useCallback, useEffect, useRef, useState } from 'react';
import { buildsSchema, buildRootSchema, repositorySchema, type Game } from '@playground/shared';
import { z } from 'zod';
import { api } from './api';
import { Feedback, Field, useAction } from './forms';

type BuildData = z.infer<typeof buildsSchema>;
const labels = { queued: 'В очереди', running: 'Собирается', succeeded: 'Опубликовано', failed: 'Ошибка сборки' };
export function BuildPanel({ game, onChanged }: { game: Game; onChanged: () => Promise<void> }) {
  const [data, setData] = useState<BuildData | null>(null);
  const [error, setError] = useState('');
  const [root, setRoot] = useState('.');
  const [openLogs, setOpenLogs] = useState(false);
  const action = useAction();
  const previous = useRef<string | null>(null);
  const base = `/admin/games/${game.id}`;
  const refresh = useCallback(async () => {
    const next = buildsSchema.parse(await api(`${base}/builds`)); setData(next); setError('');
    return next;
  }, [base]);
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const next = buildsSchema.parse(await api(`${base}/builds`));
        if (!active) return;
        setData(next); setError('');
        const latest = next.jobs[0];
        const state = latest ? `${latest.id}:${latest.status}` : '';
        if (previous.current && previous.current !== state && latest?.status === 'succeeded') {
          window.dispatchEvent(new Event('release-changed')); await onChanged();
        }
        previous.current = state;
        if (next.jobs.some(job => job.status === 'queued' || job.status === 'running') || !next.workerReady) timer = setTimeout(load, 2500);
      } catch (error) { if (active) setError(error instanceof Error ? error.message : 'Не удалось загрузить сборки.'); }
    };
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, [base, onChanged, data?.jobs[0]?.id]);
  const busy = !!data?.jobs.some(job => job.status === 'queued' || job.status === 'running');
  const latest = data?.jobs[0];
  return <section className="repository-panel" aria-labelledby={`build-${game.id}`}>
    <div className="section-heading"><h3 id={`build-${game.id}`}>Сборка и публикация</h3><span className="pill">Docker · Node.js</span></div>
    <p className="fine-print">Собираем последний проверенный коммит main. Неудачная сборка сохраняет рабочую версию.</p>
    {data && <p className="fine-print">{data.workerMessage}</p>}
    <Field label="Папка проекта"><input value={root} onChange={event => setRoot(event.target.value)} disabled={busy || action.busy} maxLength={200} /><small>Оставьте . для корня или единственного вложенного проекта. Для needle можно указать needle-in-a-haystack.</small></Field>
    <div className="button-row"><button className="primary" disabled={busy || action.busy || game.archived || !data?.workerReady} onClick={() => void action.run(async () => {
      const parsed = buildRootSchema.safeParse(root); if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      const source = z.object({ repository: repositorySchema.nullable() }).parse(await api(`${base}/repository`)).repository;
      if (!source?.latestCommitSha) throw new Error('Сначала подключите репозиторий и проверьте обновления.');
      await api(`${base}/builds`, 'POST', { buildRoot: parsed.data, commitSha: source.latestCommitSha });
      setOpenLogs(true); await refresh(); action.setNotice('Сборка поставлена в очередь. Можно оставить страницу открытой или вернуться позже.');
    })}>{busy ? 'Сборка выполняется…' : action.busy ? 'Подготавливаем…' : 'Собрать и опубликовать'}</button><button onClick={() => void refresh().catch(error => setError(error.message))}>Обновить статус сборки</button></div>
    <Feedback {...action} /><Feedback error={error} />
    {latest && <div className="build-result"><p><strong>{labels[latest.status]}</strong> · <code>{latest.commitSha.slice(0, 12)}</code></p>{latest.error && <p className="feedback error">{latest.error}</p>}<button className="quiet" onClick={() => setOpenLogs(!openLogs)}>{openLogs ? 'Скрыть журнал сборки' : 'Показать журнал сборки'}</button>{openLogs && <pre className="build-logs">{latest.logs || 'Ожидаем начало сборки…'}</pre>}</div>}
    {data && data.releases.length > 0 && <div className="release-list"><h3>Сохранённые версии</h3>{data.releases.map(release => <div className="release-row" key={release.id}><span><code>{release.commitSha.slice(0, 12)}</code><small>{new Date(release.createdAt).toLocaleString('ru')} · {(release.size / 1024 / 1024).toFixed(1)} МиБ</small></span>{release.active ? <span className="pill">Сейчас опубликована</span> : <button disabled={busy || action.busy || game.archived} onClick={() => void action.run(async () => {
      await api(`${base}/rollback`, 'POST', { releaseId: release.id }); await refresh(); await onChanged(); window.dispatchEvent(new Event('release-changed')); action.setNotice('Предыдущая версия опубликована без повторной сборки.');
    })}>Откатить к этой версии</button>}</div>)}</div>}
  </section>;
}
export function Player({ game }: { game: Game }) {
  const [url, setUrl] = useState(''); const action = useAction(); const frame = useRef<HTMLIFrameElement>(null);
  return <section className="player-section"><div className="play-status"><div><h2>Запуск игры</h2><p className="muted">{game.activeReleaseId ? `Опубликован коммит ${game.deployedCommitSha?.slice(0, 12)}. Игра открывается в отдельном защищённом окружении.` : 'У игры пока нет опубликованной версии. Администратор может собрать её в редакторе.'}</p></div><button className="primary" disabled={!game.activeReleaseId || game.archived || action.busy} onClick={() => void action.run(async () => {
    const value = await api<{ url: string }>(`/games/${game.id}/play`, 'POST', {}); setUrl(value.url);
  })}>{action.busy ? 'Открываем…' : url ? 'Перезапустить игру' : 'Играть'}</button></div><Feedback {...action} />{url && <div className="player"><div className="button-row"><button onClick={() => void frame.current?.requestFullscreen().catch(() => {})}>На весь экран</button><a href={url} target="_blank" rel="noopener noreferrer">Открыть отдельно ↗</a><span className="fine-print">Доступ действует час. Для продления перезапустите игру.</span></div><iframe ref={frame} key={url} src={url} title={game.title} sandbox="allow-scripts allow-same-origin allow-pointer-lock" allow="fullscreen; autoplay; gamepad" allowFullScreen referrerPolicy="no-referrer" /></div>}</section>;
}

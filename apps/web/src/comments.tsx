import { useEffect, useState, type FormEvent } from 'react';
import { commentInputSchema, commentsPageSchema, type Game } from '@playground/shared';
import { z } from 'zod';
import { api } from './api';
import { Feedback, Field, useAction } from './forms';

type Page = z.infer<typeof commentsPageSchema>;
export function Comments({ game }: { game: Game }) {
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const action = useAction();
  const base = `/games/${encodeURIComponent(game.slug)}/comments`;
  useEffect(() => {
    let active = true;
    setPage(null); setError('');
    api(`${base}?offset=${offset}&limit=20&includeHidden=${includeHidden ? 1 : 0}`)
      .then(data => { if (active) setPage(commentsPageSchema.parse(data)); })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [base, offset, includeHidden, revision]);

  function refresh() { setRevision(value => value + 1); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await action.run(async () => {
      const input = commentInputSchema.safeParse({ body: draft });
      if (!input.success) throw new Error(input.error.issues[0].message);
      await api(base, 'POST', input.data);
      setDraft(''); setOffset(0); refresh(); action.setNotice('Комментарий опубликован.');
    });
  }
  async function edit(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const body = new FormData(event.currentTarget).get('body');
    await action.run(async () => {
      const input = commentInputSchema.safeParse({ body });
      if (!input.success) throw new Error(input.error.issues[0].message);
      await api(`${base}/${id}`, 'PATCH', input.data);
      setEditing(null); refresh(); action.setNotice('Комментарий обновлён.');
    });
  }
  return <section className="comments-section" aria-labelledby="comments-title">
    <div className="section-heading"><div><p className="eyebrow">ОБСУЖДЕНИЕ ПРОЕКТА</p><h2 id="comments-title">Обратная связь{page ? ` · ${page.total}` : ''}</h2></div>{game.canModerate && <label className="check"><input type="checkbox" checked={includeHidden} onChange={event => { setIncludeHidden(event.target.checked); setOffset(0); }} />Показать скрытые</label>}</div>
    {game.canComment ? <form className="panel comment-compose" onSubmit={submit}><fieldset disabled={action.busy}><Field label="Ваш комментарий"><textarea value={draft} onChange={event => setDraft(event.target.value)} required maxLength={4000} rows={4} placeholder="Что работает, что стоит улучшить?" /></Field><div className="compose-bottom"><span className="fine-print">{draft.length} / 4000</span><button className="primary" type="submit">{action.busy ? 'Сохраняем…' : 'Отправить комментарий'}</button></div></fieldset></form> : <p className="read-only">{game.archived ? 'Игра в архиве. Обсуждение доступно только для чтения.' : 'У вас доступ на чтение. Комментировать могут тестеры и администраторы.'}</p>}
    <Feedback {...action} /><Feedback error={error} />
    {!page && !error && <p className="muted" role="status">Загружаем комментарии…</p>}
    {error && <button onClick={refresh}>Повторить загрузку</button>}
    {page?.comments.length === 0 && <div className="comments-empty"><h3>{offset > 0 ? 'На этой странице больше нет комментариев' : 'Пока без комментариев'}</h3><p>{offset > 0 ? 'Вернитесь на предыдущую страницу.' : 'Здесь команда сможет обсудить игру и оставить результаты тестирования.'}</p></div>}
    <div className="comment-list">{page?.comments.map(comment => <article className={`comment ${comment.status === 'hidden' ? 'comment-hidden' : ''}`} key={comment.id}>
      <div className="comment-heading"><span className="avatar" aria-hidden="true">{comment.authorName.slice(0, 1).toUpperCase()}</span><div><strong>{comment.authorName}</strong><time dateTime={new Date(comment.createdAt).toISOString()}>{new Date(comment.createdAt).toLocaleString('ru')}{comment.editedAt ? ' · изменён' : ''}</time></div>{comment.status === 'hidden' && <span className="pill">Скрыт</span>}</div>
      {editing === comment.id && comment.canEdit ? <form onSubmit={event => void edit(event, comment.id)}><fieldset disabled={action.busy}><Field label="Текст комментария"><textarea name="body" defaultValue={comment.body} required maxLength={4000} rows={4} /></Field><div className="button-row"><button type="submit" className="primary">Сохранить комментарий</button><button type="button" onClick={() => setEditing(null)}>Отмена</button></div></fieldset></form> : <p className="comment-body">{comment.body}</p>}
      <div className="comment-actions">{comment.canEdit && editing !== comment.id && <button className="quiet" disabled={action.busy} onClick={() => setEditing(comment.id)}>Редактировать</button>}{game.canModerate && <button className="quiet" disabled={action.busy} onClick={() => void action.run(async () => {
        await api(`${base}/${comment.id}/moderate`, 'POST', { status: comment.status === 'hidden' ? 'visible' : 'hidden' });
        refresh(); action.setNotice(comment.status === 'hidden' ? 'Комментарий восстановлен.' : 'Комментарий скрыт.');
      })}>{comment.status === 'hidden' ? 'Восстановить' : 'Скрыть'}</button>}</div>
    </article>)}</div>
    {page && (page.total > page.limit || offset > 0) && <nav className="pagination" aria-label="Страницы комментариев"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - page.limit))}>← Назад</button><span className="fine-print">Страница {Math.floor(offset / page.limit) + 1}</span><button disabled={offset + page.limit >= page.total} onClick={() => setOffset(offset + page.limit)}>Далее →</button></nav>}
  </section>;
}

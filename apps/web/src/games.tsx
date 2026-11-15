import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { gameInputSchema, gameSchema, type Game } from '@playground/shared';
import { z } from 'zod';
import { api, uploadCover } from './api';
import { Field, Feedback, useAction } from './forms';
import { Comments } from './comments';

const gameResponse = z.object({ game: gameSchema });
const gamesResponse = z.object({ games: z.array(gameSchema) });
export function GameCover({ game }: { game: Game }) {
  return <div className="game-cover"><span aria-hidden="true">{game.title.slice(0, 1)}</span>{game.cover && <img key={game.cover} src={game.cover} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none'; }} />}</div>;
}
export function Library({ admin }: { admin: boolean }) {
  const [games, setGames] = useState<Game[] | null>(null);
  const [error, setError] = useState('');
  const shelf = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    api('/games').then(data => { if (active) setGames(gamesResponse.parse(data).games); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, []);
  const featured = games?.[0];
  return <><section className="page-intro"><p className="eyebrow">НАШЕ РАБОЧЕЕ ПРОСТРАНСТВО</p><div className="title-row"><h1>Библиотека</h1>{admin && <a className="button primary" href="#/admin/games/new">+ Добавить игру</a>}</div><p className="intro">Игры команды. Версии, эксперименты и новые идеи.</p></section><Feedback error={error} />
    {games === null && !error && <p role="status" className="muted">Загружаем библиотеку…</p>}
    {games?.length === 0 && <div className="empty-state"><span className="empty-icon" aria-hidden="true">▦</span><h2>Здесь будут наши игры</h2><p>{admin ? 'Создайте первую карточку: добавьте название, описание и обложку. Команда сможет оставить обратную связь.' : 'Пока нет доступных игр. Попросите администратора назначить доступ к проектам команды.'}</p>{admin ? <a className="button primary" href="#/admin/games/new">Добавить первую игру</a> : <span className="pill">Доступ к каждой игре назначает администратор</span>}</div>}
    {featured && <section className="featured" aria-label="Недавно обновлённая игра"><div className="featured-art"><GameCover game={featured} /></div><div className="featured-copy"><p className="eyebrow">СЕЙЧАС В РАБОТЕ</p><h2>{featured.title}</h2><p>{featured.description || 'Новый проект нашей команды.'}</p><span className="pill">Карточка проекта · пока без релиза</span><div><a className="button primary" href={`#/games/${featured.slug}`}>Открыть проект →</a></div></div></section>}
    {games && games.length > 0 && <section className="library-shelf"><div className="section-heading"><h2>Проекты команды <span className="muted">· {games.length}</span></h2><div className="button-row shelf-controls"><button aria-label="Прокрутить игры влево" onClick={() => shelf.current?.scrollBy({ left: -350, behavior: 'auto' })}>←</button><button aria-label="Прокрутить игры вправо" onClick={() => shelf.current?.scrollBy({ left: 350, behavior: 'auto' })}>→</button></div></div><div className="game-shelf" ref={shelf}>{games.map(game => <a className="game-card" key={game.id} href={`#/games/${game.slug}`}><GameCover game={game} /><div className="game-card-copy"><h3>{game.title}</h3><p>{game.description || 'Описание пока не добавлено.'}</p><span className="pill">Без опубликованной версии</span><small>Обновлено {new Date(game.updatedAt).toLocaleDateString('ru')}</small></div></a>)}</div></section>}
  </>;
}
export function GameDetail({ slug, admin }: { slug: string; admin: boolean }) {
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api(`/games/${slug}`).then(data => { if (active) setGame(gameResponse.parse(data).game); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [slug]);
  return <div className="detail"><a href="#/library">← В библиотеку</a><Feedback error={error} />{!game && !error && <p role="status">Загружаем игру…</p>}{game && <><div className="game-hero"><GameCover game={game} /><div><p className="eyebrow">ПРОЕКТ КОМАНДЫ</p><h1>{game.title}</h1><p className="intro game-description">{game.description || 'Описание пока не добавлено.'}</p><div className="button-row"><span className="pill">{game.archived ? 'В архиве' : 'Опубликованной версии пока нет'}</span>{admin && <a href={`#/admin/games/${game.id}`}>Редактировать игру</a>}</div><p className="fine-print">Карточка обновлена {new Date(game.updatedAt).toLocaleString('ru')}</p></div></div><div className="play-status"><div><h2>Запуск игры</h2><p className="muted">Подключение GitHub, сборки и запуск появятся в следующих этапах. Уже можно обсуждать проект ниже.</p></div><button disabled>Нет опубликованной версии</button></div><Comments game={game} /></>}</div>;
}

function GameEditor({ game, onSaved }: { game: Game | null; onSaved: (id: string) => Promise<void> }) {
  const [title, setTitle] = useState(game?.title ?? '');
  const [slug, setSlug] = useState(game?.slug ?? '');
  const [description, setDescription] = useState(game?.description ?? '');
  const [file, setFile] = useState<File | null>(null);
  const action = useAction();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await action.run(async () => {
      const data = gameInputSchema.safeParse({ title, slug, description });
      if (!data.success) throw new Error(data.error.issues[0].message);
      const saved = gameResponse.parse(await api(game ? `/admin/games/${game.id}` : '/admin/games', game ? 'PATCH' : 'POST', data.data));
      await onSaved(saved.game.id); action.setNotice('Карточка сохранена.');
    });
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    await action.run(async () => {
      if (!file) throw new Error('Выберите обложку.');
      if (file.size > 5 * 1024 * 1024) throw new Error('Обложка должна быть не больше 5 МиБ.');
      await uploadCover(`/admin/games/${game!.id}/cover`, file);
      setFile(null); form.reset(); await onSaved(game!.id); action.setNotice('Обложка обновлена.');
    });
  }
  return <section className="panel game-editor"><p className="eyebrow">{game ? 'КАРТОЧКА ПРОЕКТА' : 'НОВЫЙ ПРОЕКТ'}</p><h2>{game ? game.title : 'Добавить игру'}</h2>{game && <div className="button-row editor-links"><span className="pill">{game.archived ? 'В архиве' : 'В библиотеке'}</span><a href={`#/games/${game.slug}`}>Открыть страницу игры →</a></div>}
    <form onSubmit={submit}><fieldset disabled={action.busy}><Field label="Название игры"><input value={title} onChange={event => setTitle(event.target.value)} required maxLength={100} /></Field><Field label="Адрес игры"><input value={slug} onChange={event => setSlug(event.target.value)} required maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="needle-in-a-haystack" /><small>Латиница в нижнем регистре, цифры и дефисы. При изменении адреса комментарии сохранятся.</small></Field><Field label="Описание"><textarea value={description} onChange={event => setDescription(event.target.value)} rows={5} maxLength={5000} /><small>{description.length} / 5000 · обычный текст</small></Field><button className="primary" type="submit">{action.busy ? 'Сохраняем…' : game ? 'Сохранить карточку' : 'Создать карточку'}</button></fieldset></form>
    {game ? <><div className="cover-editor"><h3>Обложка</h3><GameCover game={game} /><form onSubmit={upload}><fieldset disabled={action.busy}><Field label="Файл обложки"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => setFile(event.target.files?.[0] ?? null)} required /><small>PNG, JPEG или WebP. До 5 МиБ и 16 мегапикселей. Без анимации.</small></Field><div className="button-row"><button disabled={!file} type="submit">Загрузить обложку</button>{game.cover && <button type="button" onClick={() => void action.run(async () => { await api(`/admin/games/${game.id}/cover`, 'DELETE', {}); await onSaved(game.id); action.setNotice('Обложка удалена.'); })}>Убрать обложку</button>}</div></fieldset></form></div><div className="account-actions"><h3>{game.archived ? 'Вернуть в библиотеку' : 'Архивировать проект'}</h3><p className="fine-print">Архивирование скрывает игру от команды. Комментарии, обложка и назначенные права сохраняются.</p><button disabled={action.busy} onClick={() => void action.run(async () => { await api(`/admin/games/${game.id}/archive`, 'POST', { archived: !game.archived }); await onSaved(game.id); action.setNotice(game.archived ? 'Игра возвращена в библиотеку.' : 'Игра перенесена в архив.'); })}>{game.archived ? 'Вернуть из архива' : 'В архив'}</button></div></> : <p className="fine-print">После создания карточки можно загрузить обложку и назначить доступ коллегам в разделе «Команда».</p>}
    <Feedback {...action} />
  </section>;
}

export function ManageGames({ selectedId }: { selectedId: string | null }) {
  const [games, setGames] = useState<Game[] | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(async (id?: string) => {
    const data = gamesResponse.parse(await api('/admin/games'));
    setGames(data.games);
    if (id) window.location.hash = `/admin/games/${id}`;
  }, []);
  useEffect(() => { reload().catch(error => setError(error.message)); }, [reload]);
  const selected = games?.find(game => game.id === selectedId);
  return <><section className="page-intro"><p className="eyebrow">АДМИНИСТРИРОВАНИЕ</p><div className="title-row"><h1>Наши игры</h1><a className="button primary" href="#/admin/games/new">+ Добавить игру</a></div><p className="intro">Карточки проектов, обложки и архив команды.</p></section><Feedback error={error} />{!games && !error && <p role="status">Загружаем проекты…</p>}{games && <div className="games-admin-layout"><aside className="game-admin-list" aria-label="Игры команды">{games.length === 0 && <p className="muted">Первую игру можно добавить справа.</p>}{games.map(game => <a key={game.id} href={`#/admin/games/${game.id}`} className={`admin-game-item ${selectedId === game.id ? 'selected' : ''}`} aria-current={selectedId === game.id ? 'page' : undefined}><GameCover game={game} /><span><strong>{game.title}</strong><small>{game.archived ? 'В архиве' : 'В библиотеке'}</small></span></a>)}</aside>{selectedId && selectedId !== 'new' && !selected ? <div className="empty-state"><h2>Игра не найдена</h2><a href="#/admin/games/new">Создать игру</a></div> : <GameEditor key={selected?.id ?? 'new'} game={selected ?? null} onSaved={reload} />}</div>}</>;
}

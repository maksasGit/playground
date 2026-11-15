import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { gameSchema, type Game, type Session } from '@playground/shared';
import { z } from 'zod';
import { api, loadSession, rememberSession } from './api';
import { Feedback, Login, PasswordForm, useAction } from './forms';
import { Users, roleLabels } from './users';
import './style.css';

function Library() {
  const [games, setGames] = useState<Game[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api('/games').then(data => { if (active) setGames(z.object({ games: z.array(gameSchema) }).parse(data).games); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, []);
  return <><section className="page-intro"><p className="eyebrow">НАШЕ РАБОЧЕЕ ПРОСТРАНСТВО</p><h1>Библиотека</h1><p className="intro">Игры команды. Версии, эксперименты и новые идеи.</p></section><Feedback error={error} />
    {games === null && !error && <p role="status" className="muted">Загружаем библиотеку…</p>}
    {games?.length === 0 && <div className="empty-state"><span className="empty-icon" aria-hidden="true">▦</span><h2>Здесь будут наши игры</h2><p>Пока нет доступных игр. Добавление игр и публикация появятся в следующих этапах.</p><span className="pill">Доступ к каждой игре назначает администратор</span></div>}
    {games && games.length > 0 && <div className="game-grid">{games.map(game => <a className="game-card" key={game.id} href={`#/games/${encodeURIComponent(game.slug)}`}><div className="game-cover"><span aria-hidden="true">{game.title.slice(0, 1)}</span></div><div className="game-card-copy"><h2>{game.title}</h2><p>{game.description}</p><small>Обновлено {new Date(game.updatedAt).toLocaleDateString('ru')}</small></div></a>)}</div>}
  </>;
}
function GameDetail({ slug }: { slug: string }) {
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api(`/games/${slug}`).then(data => { if (active) setGame(z.object({ game: gameSchema }).parse(data).game); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [slug]);
  return <div className="detail"><a href="#/library">← В библиотеку</a><Feedback error={error} />{!game && !error && <p role="status">Загружаем игру…</p>}{game && <><div className="detail-hero"><p className="eyebrow">ПРОЕКТ КОМАНДЫ</p><h1>{game.title}</h1><p className="intro">{game.description}</p><span className="pill">Опубликованной версии пока нет</span></div><div className="detail-panels"><article><h2>Запуск игры</h2><p>Играть можно будет после подключения сборок и публикации.</p><button disabled>Нет опубликованной версии</button></article><article><h2>Обратная связь</h2><p>{game.canComment ? 'Комментарии команды появятся на следующем этапе.' : 'У вас доступ на чтение. Комментарии появятся на следующем этапе.'}</p></article></div></>}</div>;
}
function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [route, setRoute] = useState(window.location.hash.slice(1) || '/library');
  const logoutAction = useAction();
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash.slice(1) || '/library');
    const onExpired = () => { rememberSession(null); setSession(null); };
    window.addEventListener('hashchange', onHash); window.addEventListener('session-expired', onExpired);
    loadSession().then(value => { setSession(value.session); setSetupRequired(value.setupRequired); }).catch(error => setError(error.message)).finally(() => setLoading(false));
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('session-expired', onExpired); };
  }, []);
  const user = session?.user;
  function signedIn(value: Session) { setSession(value); setSetupRequired(false); }
  async function logout() {
    await logoutAction.run(async () => { await api('/auth/logout', 'POST', {}); rememberSession(null); setSession(null); window.location.hash = '/library'; });
  }
  let page: ReactNode;
  if (loading) page = <div className="loading" role="status">Открываем Playground…</div>;
  else if (error) page = <div className="empty-state"><Feedback error={error} /><button onClick={() => window.location.reload()}>Повторить подключение</button></div>;
  else if (!user) page = <Login setupRequired={setupRequired} onSession={signedIn} />;
  else if (user.mustChangePassword) page = <PasswordForm firstLogin onSession={signedIn} />;
  else if (route === '/account') page = <PasswordForm firstLogin={false} onSession={signedIn} />;
  else if (route === '/library') page = <Library key={`${user.id}-${user.role}`} />;
  else if (route.startsWith('/games/')) page = <GameDetail key={route} slug={route.slice('/games/'.length)} />;
  else if (route === '/admin/users' && user.role === 'Admin') page = <Users currentUserId={user.id} />;
  else page = <div className="empty-state"><h2>Страница недоступна</h2><a href="#/library">Открыть библиотеку</a></div>;
  return <main><header><a className="brand" href="#/library"><span className="mark" aria-hidden="true">P</span><strong>playground</strong></a><span className="badge">Локальная среда</span>{user && <div className="user-menu"><a href="#/account">{user.displayName || user.username}</a><button className="quiet" disabled={logoutAction.busy} onClick={() => void logout()}>Выйти</button></div>}</header>
    {user && !user.mustChangePassword && <nav aria-label="Основная навигация"><a href="#/library" aria-current={route === '/library' || route.startsWith('/games/') ? 'page' : undefined}>Библиотека</a>{user.role === 'Admin' && <a href="#/admin/users" aria-current={route === '/admin/users' ? 'page' : undefined}>Команда</a>}<a href="#/account" aria-current={route === '/account' ? 'page' : undefined}>Мой аккаунт</a></nav>}
    <Feedback error={logoutAction.error} />{page}<footer>Playground · пространство команды<span>{user ? roleLabels[user.role] : 'Только для участников команды'}</span></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);

import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { type Session } from '@playground/shared';
import { api, loadSession, rememberSession } from './api';
import { Feedback, Login, PasswordForm, useAction } from './forms';
import { Users, roleLabels } from './users';
import { GameDetail, Library, ManageGames } from './games';
import './style.css';

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
  else if (route === '/library') page = <Library key={`${user.id}-${user.role}`} admin={user.role === 'Admin'} />;
  else if (route.startsWith('/games/')) page = <GameDetail key={route} slug={route.slice('/games/'.length)} admin={user.role === 'Admin'} />;
  else if ((route === '/admin/games' || route.startsWith('/admin/games/')) && user.role === 'Admin') page = <ManageGames selectedId={route.slice('/admin/games/'.length) || null} />;
  else if (route === '/admin/users' && user.role === 'Admin') page = <Users currentUserId={user.id} />;
  else page = <div className="empty-state"><h2>Страница недоступна</h2><a href="#/library">Открыть библиотеку</a></div>;
  return <main><header><a className="brand" href="#/library"><span className="mark" aria-hidden="true">P</span><strong>playground</strong></a><span className="badge">Локальная среда</span>{user && <div className="user-menu"><a href="#/account">{user.displayName || user.username}</a><button className="quiet" disabled={logoutAction.busy} onClick={() => void logout()}>Выйти</button></div>}</header>
    {user && !user.mustChangePassword && <nav aria-label="Основная навигация"><a href="#/library" aria-current={route === '/library' || route.startsWith('/games/') ? 'page' : undefined}>Библиотека</a>{user.role === 'Admin' && <><a href="#/admin/games" aria-current={route.startsWith('/admin/games') ? 'page' : undefined}>Игры</a><a href="#/admin/users" aria-current={route === '/admin/users' ? 'page' : undefined}>Команда</a></>}<a href="#/account" aria-current={route === '/account' ? 'page' : undefined}>Мой аккаунт</a></nav>}
    <Feedback error={logoutAction.error} />{page}<footer>Playground · пространство команды<span>{user ? roleLabels[user.role] : 'Только для участников команды'}</span></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);

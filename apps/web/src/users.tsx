import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { gameSchema, userSchema, type Game, type Role, type User } from '@playground/shared';
import { z } from 'zod';
import { api } from './api';
import { Field, Feedback, useAction } from './forms';

export const roleLabels: Record<Role, string> = { Admin: 'Администратор', Tester: 'Тестер', Viewer: 'Наблюдатель' };
function UserEditor({ user, games, onSaved, currentUserId }: { user: User | null; games: Game[]; onSaved: (id: string) => Promise<void>; currentUserId: string }) {
  const action = useAction();
  const [role, setRole] = useState<Role>(user?.role ?? 'Tester');
  const [status, setStatus] = useState<User['status']>(user?.status ?? 'active');
  const [gameIds, setGameIds] = useState<string[]>(user?.gameIds ?? []);
  const [permissions, setPermissions] = useState<User['vaultPermissions']>(user?.vaultPermissions ?? []);
  const [resetOpen, setResetOpen] = useState(false);
  const own = user?.id === currentUserId;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = { displayName: String(data.get('displayName')), role, gameIds, vaultPermissions: permissions };
    await action.run(async () => {
      const result = z.object({ user: userSchema }).parse(await api(user ? `/admin/users/${user.id}` : '/admin/users', user ? 'PATCH' : 'POST', user ? { ...input, status } : { ...input, username: data.get('username'), password: data.get('password') }));
      await onSaved(result.user.id);
      action.setNotice(user ? 'Изменения сохранены.' : 'Аккаунт создан. Передайте коллеге имя и начальный пароль безопасным способом.');
    });
  }
  async function reset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const password = new FormData(form).get('password');
    await action.run(async () => {
      await api(`/admin/users/${user!.id}/reset-password`, 'POST', { password });
      form.reset(); setResetOpen(false); await onSaved(user!.id);
      action.setNotice('Пароль сброшен. При следующем входе потребуется сменить его.');
    });
  }
  return <section className="panel editor" aria-label={user ? `Аккаунт ${user.username}` : 'Новый аккаунт'}>
    <p className="eyebrow">{user ? 'АККАУНТ КОМАНДЫ' : 'ПРИГЛАСИТЬ КОЛЛЕГУ'}</p><h2>{user ? user.username : 'Новый пользователь'}{own && <span className="pill">Это вы</span>}</h2>{user?.mustChangePassword && <p className="fine-print">Ожидается смена начального пароля.</p>}
    <form onSubmit={submit}><fieldset disabled={action.busy}>
      {!user && <Field label="Имя пользователя"><input name="username" required minLength={3} maxLength={32} pattern="[a-zA-Z0-9_.\-]+" autoComplete="off" /><small>Латиница, цифры, точка, дефис или подчёркивание.</small></Field>}
      <Field label="Отображаемое имя"><input name="displayName" maxLength={80} defaultValue={user?.displayName ?? ''} autoComplete="off" /></Field>
      {!user && <Field label="Начальный пароль"><input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /><small>Минимум 12 символов. Коллега заменит его при первом входе.</small></Field>}
      <div className="form-row"><Field label="Роль"><select value={role} onChange={event => setRole(event.target.value as Role)}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>{user && <Field label="Статус"><select value={status} onChange={event => setStatus(event.target.value as User['status'])}><option value="active">Активен</option><option value="disabled">Отключён</option></select></Field>}</div>
      <div className="permissions"><h3>Доступ к играм</h3>{role === 'Admin' ? <p className="muted">Администратор видит все игры.</p> : games.length === 0 ? <p className="muted">Игр пока нет. Доступ можно будет выдать после их добавления.</p> : games.map(game => <label className="check" key={game.id}><input type="checkbox" checked={gameIds.includes(game.id)} onChange={event => setGameIds(event.target.checked ? [...gameIds, game.id] : gameIds.filter(id => id !== game.id))} />{game.title}</label>)}</div>
      <div className="permissions"><h3>Права Vault</h3>{role === 'Admin' ? <p className="muted">У администратора полный доступ.</p> : (['vault:read', 'vault:upload', 'vault:manage'] as const).map((permission, index) => <label className="check" key={permission}><input type="checkbox" checked={permissions.includes(permission)} onChange={event => setPermissions(event.target.checked ? [...permissions, permission] : permissions.filter(value => value !== permission))} />{['Чтение и скачивание', 'Загрузка файлов', 'Управление файлами'][index]}</label>)}<p className="fine-print">Права сохраняются отдельно от доступа к играм. Сам Vault появится позже.</p></div>
      <button type="submit" className="primary">{action.busy ? 'Сохраняем…' : user ? 'Сохранить изменения' : 'Создать аккаунт'}</button>
    </fieldset></form>
    {user && <div className="account-actions"><h3>Безопасность аккаунта</h3><p className="fine-print">Смена роли, отключение и сброс пароля завершают все сессии пользователя.</p><div className="button-row"><button disabled={action.busy} onClick={() => setResetOpen(!resetOpen)}>Сбросить пароль</button><button disabled={action.busy} onClick={() => void action.run(async () => { await api(`/admin/users/${user.id}/revoke-sessions`, 'POST', {}); await onSaved(user.id); action.setNotice('Все сессии пользователя завершены.'); })}>Завершить все сессии{own ? ' (включая эту)' : ''}</button></div>
      {resetOpen && <form onSubmit={reset} className="reset-form"><fieldset disabled={action.busy}><Field label="Новый начальный пароль"><input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></Field><button type="submit">Подтвердить сброс{own ? ' и выйти' : ''}</button></fieldset></form>}
    </div>}<Feedback {...action} />
  </section>;
}

export function Users({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = useCallback(async (id?: string) => {
    const [userData, gameData] = await Promise.all([api('/admin/users'), api('/games')]);
    const next = z.object({ users: z.array(userSchema) }).parse(userData).users;
    setUsers(next); setGames(z.object({ games: z.array(gameSchema) }).parse(gameData).games);
    setSelected(previous => id ?? previous ?? next[0]?.id ?? 'new');
  }, []);
  useEffect(() => { reload().catch(error => setError(error.message)).finally(() => setLoading(false)); }, [reload]);
  return <><section className="page-intro"><p className="eyebrow">АДМИНИСТРИРОВАНИЕ</p><h1>Наша команда</h1><p className="intro">Личные аккаунты и доступ к рабочему пространству.</p></section><Feedback error={error} />{loading && <p role="status">Загружаем аккаунты…</p>}
    {!loading && !error && <div className="users-layout"><aside className="user-list" aria-label="Пользователи"><button className="primary full" onClick={() => setSelected('new')}>+ Создать аккаунт</button><p className="eyebrow count">УЧАСТНИКИ · {users.length}</p>{users.map(user => <button key={user.id} className={`user-item ${selected === user.id ? 'selected' : ''}`} aria-pressed={selected === user.id} onClick={() => setSelected(user.id)}><span className="avatar" aria-hidden="true">{(user.displayName || user.username).slice(0, 1).toUpperCase()}</span><span><strong>{user.displayName || user.username}</strong><small>{roleLabels[user.role]}{user.status === 'disabled' ? ' · Отключён' : ''}</small></span></button>)}</aside>{selected && <UserEditor key={selected} user={users.find(user => user.id === selected) ?? null} games={games} onSaved={reload} currentUserId={currentUserId} />}</div>}
  </>;
}

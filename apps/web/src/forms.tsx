import { Children, cloneElement, isValidElement, useId, useState, type ReactNode, type FormEvent } from 'react';
import { sessionSchema, type Session } from '@playground/shared';
import { api, rememberSession } from './api';

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Не удалось выполнить действие.'); }
    finally { setBusy(false); }
  }
  return { busy, error, notice, setNotice, run };
}
export function Feedback({ error, notice }: { error: string; notice?: string }) {
  return <>{error && <p className="feedback error" role="alert">{error}</p>}{notice && <p className="feedback success" role="status">{notice}</p>}</>;
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return <div className="field"><label htmlFor={id}>{label}</label>{Children.map(children, child =>
    isValidElement<{ id?: string }>(child) && ['input', 'select', 'textarea'].includes(String(child.type))
      ? cloneElement(child, { id }) : child,
  )}</div>;
}
export function Login({ setupRequired, onSession }: { setupRequired: boolean; onSession: (value: Session) => void }) {
  const action = useAction();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await action.run(async () => {
      const session = sessionSchema.parse(await api('/auth/login', 'POST', { username: data.get('username'), password: data.get('password') }));
      rememberSession(session); onSession(session);
    });
  }
  return <div className="welcome">
    <section className="welcome-copy"><p className="eyebrow">НАШЕ РАБОЧЕЕ ПРОСТРАНСТВО</p><h1>Место для наших игр.</h1><p className="intro">Запускать. Тестировать. Обсуждать. Всё, над чем мы работаем, — в одном месте.</p><div className="welcome-tags"><span>Закрытая библиотека</span><span>Обратная связь</span><span>Ассеты команды</span></div></section>
    <section className="panel login-panel" aria-labelledby="login-title"><span className="number">ДОБРО ПОЖАЛОВАТЬ</span><h2 id="login-title">Войти в Playground</h2><p className="muted">Личное пространство нашей команды.</p>
      {setupRequired ? <div className="setup"><h3>Первый запуск</h3><p>Создайте первого администратора в терминале из папки проекта:</p><code>npx --yes pnpm@10.34.5 admin:create</code><p>После настройки обновите страницу и войдите.</p><button onClick={() => window.location.reload()}>Проверить настройку</button></div> : <form onSubmit={submit}><fieldset disabled={action.busy}>
        <Field label="Имя пользователя"><input name="username" autoComplete="username" required maxLength={128} autoFocus /></Field><Field label="Пароль"><input name="password" type="password" autoComplete="current-password" required maxLength={128} /></Field>
        <Feedback {...action} /><button className="primary full" type="submit">{action.busy ? 'Входим…' : 'Войти'}</button>
      </fieldset></form>}<p className="fine-print">Аккаунты создаёт администратор команды.</p>
    </section>
  </div>;
}
export function PasswordForm({ firstLogin, onSession }: { firstLogin: boolean; onSession: (value: Session) => void }) {
  const action = useAction();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await action.run(async () => {
      if (data.get('password') !== data.get('confirm')) throw new Error('Новые пароли не совпадают.');
      const session = sessionSchema.parse(await api('/auth/password', 'POST', { currentPassword: data.get('current'), password: data.get('password') }));
      rememberSession(session); onSession(session); form.reset();
      action.setNotice('Пароль изменён. Остальные сессии завершены.');
    });
  }
  return <section className="panel password-panel"><p className="eyebrow">ЛИЧНЫЙ АККАУНТ</p><h2>{firstLogin ? 'Задайте свой пароль' : 'Изменить пароль'}</h2><p className="muted">{firstLogin ? 'Перед первым входом замените пароль, который выдал администратор.' : 'После смены пароля другие устройства выйдут из аккаунта.'}</p>
    <form onSubmit={submit}><fieldset disabled={action.busy}>
      <Field label="Текущий пароль"><input name="current" type="password" autoComplete="current-password" required maxLength={128} /></Field>
      <Field label="Новый пароль"><input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} aria-describedby="password-hint" /></Field>
      <Field label="Повторите новый пароль"><input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></Field>
      <p className="fine-print" id="password-hint">От 12 до 128 символов. Новый пароль должен отличаться от текущего.</p><Feedback {...action} /><button type="submit" className="primary">{action.busy ? 'Сохраняем…' : 'Сохранить пароль'}</button>
    </fieldset></form>
  </section>;
}

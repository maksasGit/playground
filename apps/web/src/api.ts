import { sessionSchema, type Session } from '@playground/shared';

let csrfToken = '';
export function rememberSession(session: Session | null) { csrfToken = session?.csrfToken ?? ''; }
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method, credentials: 'same-origin',
    headers: method === 'GET' ? {} : {
      'Content-Type': 'application/json', 'X-Playground-Request': '1', 'X-CSRF-Token': csrfToken,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('session-expired'));
    throw new Error(data.message ?? 'Не удалось выполнить запрос.');
  }
  return data as T;
}
export async function loadSession() {
  const data = await api<{ user: null; setupRequired: boolean } | Session>('/auth/session');
  if (data.user === null) { rememberSession(null); return { session: null, setupRequired: 'setupRequired' in data && data.setupRequired }; }
  const session = sessionSchema.parse(data);
  rememberSession(session);
  return { session, setupRequired: false };
}

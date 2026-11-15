import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { Game, Session, Comment } from '@playground/shared';
import { createApp } from './app.js';
import { createAccount } from './accounts.js';
import { openDatabase } from './database.js';

const browser = { origin: 'http://127.0.0.1:5173', 'x-playground-request': '1' };
const password = 'games-test-only-password';
interface Client extends Session { cookie: string }
function headers(client: Client) { return { ...browser, cookie: client.cookie, 'x-csrf-token': client.csrfToken }; }
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'playground-games-'));
  const path = join(directory, 'test.sqlite');
  const { sqlite } = openDatabase(path);
  const owner = await createAccount(sqlite, { username: 'owner', password, role: 'Admin' }, null);
  sqlite.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(owner.id);
  for (const role of ['Tester', 'Viewer'] as const) {
    const user = await createAccount(sqlite, { username: role.toLowerCase(), password, role }, owner.id);
    sqlite.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(user.id);
  }
  let app = createApp(path);
  async function login(username: string): Promise<Client> {
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: browser, payload: { username, password } });
    assert.equal(response.statusCode, 200, response.body);
    return { ...response.json<Session>(), cookie: String(response.headers['set-cookie']).split(';')[0] };
  }
  const admin = await login('owner'); const tester = await login('tester'); const viewer = await login('viewer');
  const create = async (slug: string) => {
    const response = await app.inject({ method: 'POST', url: '/api/admin/games', headers: headers(admin), payload: { title: slug, slug, description: 'Test project' } });
    assert.equal(response.statusCode, 201, response.body);
    return response.json<{ game: Game }>().game;
  };
  const grant = (client: Client, game: Game) => sqlite.prepare('INSERT INTO game_access (user_id, game_id, granted_by, granted_at) VALUES (?, ?, ?, ?)').run(client.user.id, game.id, owner.id, Date.now());
  return {
    get app() { return app; }, sqlite, admin, tester, viewer, create, grant,
    async restart() { await app.close(); app = createApp(path); await app.ready(); },
    async close() { await app.close(); sqlite.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}
function multipartBody(bytes: Buffer, mime = 'image/png', twoFiles = false) {
  const boundary = 'playground-cover-test-boundary';
  const part = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="../../untrusted.png"\r\nContent-Type: ${mime}\r\n\r\n`), bytes, Buffer.from('\r\n')]);
  return { body: Buffer.concat([part, ...(twoFiles ? [part] : []), Buffer.from(`--${boundary}--\r\n`)]), type: `multipart/form-data; boundary=${boundary}` };
}

test('game CRUD is admin-only, validated, archive is reversible and grants stay attached to immutable IDs', async () => {
  const f = await fixture();
  try {
    const game = await f.create('first'); f.grant(f.tester, game);
    for (const user of [f.tester, f.viewer]) {
      for (const url of ['/api/admin/games', `/api/admin/games/${game.id}`]) {
        assert.equal((await f.app.inject({ method: url.endsWith(game.id) ? 'PATCH' : 'POST', url, headers: headers(user), payload: { title: 'bad', slug: 'bad' } })).statusCode, 403);
      }
      assert.equal((await f.app.inject({ url: '/api/admin/games', headers: headers(user) })).statusCode, 403);
    }
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/admin/games', payload: { title: 'bad', slug: 'bad' } })).statusCode, 403);
    for (const payload of [{ title: '', slug: 'empty' }, { title: 'Bad slug', slug: '../bad' }, { title: 'Too long', slug: 'long', description: 'x'.repeat(5001) }]) {
      assert.equal((await f.app.inject({ method: 'POST', url: '/api/admin/games', headers: headers(f.admin), payload })).statusCode, 400);
    }
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/admin/games', headers: headers(f.admin), payload: { title: 'duplicate', slug: game.slug } })).statusCode, 409);
    const edited = await f.app.inject({ method: 'PATCH', url: `/api/admin/games/${game.id}`, headers: headers(f.admin), payload: { title: 'Renamed', slug: 'renamed', description: 'Changed' } });
    assert.equal(edited.statusCode, 200); assert.equal(edited.json<{ game: Game }>().game.id, game.id);
    assert.equal((await f.app.inject({ url: '/api/games/first', headers: headers(f.tester) })).statusCode, 404);
    assert.equal((await f.app.inject({ url: '/api/games/renamed', headers: headers(f.tester) })).statusCode, 200);
    const archive = (archived: boolean) => f.app.inject({ method: 'POST', url: `/api/admin/games/${game.id}/archive`, headers: headers(f.admin), payload: { archived } });
    assert.equal((await archive(true)).statusCode, 200);
    assert.deepEqual((await f.app.inject({ url: '/api/games', headers: headers(f.tester) })).json(), { games: [] });
    assert.equal((await f.app.inject({ url: '/api/games/renamed', headers: headers(f.tester) })).statusCode, 404);
    assert.equal((await f.app.inject({ url: '/api/games/renamed', headers: headers(f.admin) })).json<{ game: Game }>().game.canComment, false);
    assert.equal((await f.app.inject({ url: '/api/admin/games', headers: headers(f.admin) })).json<{ games: Game[] }>().games[0].archived, true);
    assert.equal((await archive(false)).statusCode, 200);
    assert.equal((await f.app.inject({ url: '/api/games/renamed', headers: headers(f.tester) })).statusCode, 200);
    assert.equal((await f.app.inject({ method: 'DELETE', url: `/api/admin/games/${game.id}`, headers: headers(f.admin), payload: {} })).statusCode, 404);
  } finally { await f.close(); }
});

test('covers are re-encoded, private, bounded and reject SVG, mismatched MIME, malformed and multiple files', async () => {
  const f = await fixture();
  try {
    const game = await f.create('cover'); f.grant(f.tester, game);
    const png = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#36b8e9' } }).png().toBuffer();
    const upload = (data: Buffer, mime = 'image/png', client = f.admin, twoFiles = false) => {
      const file = multipartBody(data, mime, twoFiles);
      return f.app.inject({ method: 'POST', url: `/api/admin/games/${game.id}/cover`, headers: { ...headers(client), 'content-type': file.type }, payload: file.body });
    };
    assert.equal((await upload(png, 'image/png', f.tester)).statusCode, 403);
    const response = await upload(png);
    assert.equal(response.statusCode, 200, response.body);
    const coverUrl = response.json<{ game: Game }>().game.cover!;
    const cover = await f.app.inject({ url: coverUrl, headers: headers(f.tester) });
    assert.equal(cover.statusCode, 200); assert.match(String(cover.headers['content-type']), /image\/webp/);
    assert.equal(cover.headers['cache-control'], 'no-store');
    assert.equal((await sharp(cover.rawPayload).metadata()).format, 'webp');
    assert.equal((await f.app.inject(coverUrl)).statusCode, 401);
    assert.equal((await f.app.inject({ url: coverUrl, headers: headers(f.viewer) })).statusCode, 404);
    assert.equal((await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml')).statusCode, 400);
    assert.equal((await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).statusCode, 400);
    assert.equal((await upload(png, 'image/jpeg')).statusCode, 400);
    assert.equal((await upload(Buffer.from('not an image'))).statusCode, 400);
    assert.equal((await upload(Buffer.alloc(5 * 1024 * 1024 + 1))).statusCode, 413);
    assert.equal((await upload(png, 'image/png', f.admin, true)).statusCode, 400);
    assert.deepEqual(f.sqlite.prepare('SELECT COUNT(*) AS count FROM game_covers').get(), { count: 1 });
    assert.equal((await f.app.inject({ url: coverUrl, headers: headers(f.tester) })).statusCode, 200);
    await f.restart();
    assert.equal((await f.app.inject({ url: coverUrl, headers: headers(f.tester) })).statusCode, 200);
    assert.equal((await f.app.inject({ method: 'DELETE', url: `/api/admin/games/${game.id}/cover`, headers: headers(f.admin), payload: {} })).statusCode, 200);
    assert.equal((await f.app.inject({ url: coverUrl, headers: headers(f.tester) })).statusCode, 404);
  } finally { await f.close(); }
});

test('comment writes enforce role, game permission, CSRF, ownership and length', async () => {
  const f = await fixture();
  try {
    const game = await f.create('comments'); f.grant(f.tester, game); f.grant(f.viewer, game);
    const other = await f.create('other');
    const url = `/api/games/${game.slug}/comments`;
    assert.equal((await f.app.inject(url)).statusCode, 401);
    assert.equal((await f.app.inject({ url: `/api/games/${other.slug}/comments`, headers: headers(f.tester) })).statusCode, 404);
    const post = (client: Client, body: string) => f.app.inject({ method: 'POST', url, headers: headers(client), payload: { body } });
    assert.equal((await post(f.viewer, 'not allowed')).statusCode, 403);
    assert.equal((await f.app.inject({ method: 'POST', url, headers: { ...browser, cookie: f.tester.cookie }, payload: { body: 'missing CSRF' } })).statusCode, 403);
    assert.equal((await post(f.tester, '  \n ')).statusCode, 400);
    assert.equal((await post(f.tester, 'x'.repeat(4001))).statusCode, 400);
    const text = '<img src=x onerror="alert(1)">\nUseful feedback';
    const created = await post(f.tester, text);
    assert.equal(created.statusCode, 201, created.body);
    const comment = created.json<{ comment: Comment }>().comment;
    assert.equal(comment.body, text); assert.equal(comment.authorId, f.tester.user.id);
    assert.equal((await f.app.inject({ url, headers: headers(f.viewer) })).json<{ comments: Comment[] }>().comments[0].canEdit, false);
    assert.equal((await f.app.inject({ method: 'PATCH', url: `${url}/${comment.id}`, headers: headers(f.admin), payload: { body: 'not mine' } })).statusCode, 403);
    assert.equal((await f.app.inject({ method: 'PATCH', url: `/api/games/${other.slug}/comments/${comment.id}`, headers: headers(f.admin), payload: { body: 'wrong game' } })).statusCode, 404);
    const edited = await f.app.inject({ method: 'PATCH', url: `${url}/${comment.id}`, headers: headers(f.tester), payload: { body: 'Corrected feedback' } });
    assert.equal(edited.statusCode, 200); assert.ok(edited.json<{ comment: Comment }>().comment.editedAt);
    assert.equal(edited.json<{ comment: Comment }>().comment.createdAt, comment.createdAt);
  } finally { await f.close(); }
});

test('moderation is admin-only, hidden comments cannot be exposed or edited and archives preserve discussion', async () => {
  const f = await fixture();
  try {
    const game = await f.create('moderation'); f.grant(f.tester, game); f.grant(f.viewer, game);
    const url = `/api/games/${game.slug}/comments`;
    const created = await f.app.inject({ method: 'POST', url, headers: headers(f.tester), payload: { body: 'Feedback to moderate' } });
    const comment = created.json<{ comment: Comment }>().comment;
    const moderate = (client: Client, status: string) => f.app.inject({ method: 'POST', url: `${url}/${comment.id}/moderate`, headers: headers(client), payload: { status } });
    assert.equal((await moderate(f.tester, 'hidden')).statusCode, 403);
    assert.equal((await moderate(f.admin, 'hidden')).statusCode, 200);
    assert.equal((await f.app.inject({ url, headers: headers(f.tester) })).json<{ total: number }>().total, 0);
    assert.equal((await f.app.inject({ url: `${url}?includeHidden=1`, headers: headers(f.viewer) })).statusCode, 403);
    assert.equal((await f.app.inject({ url: `${url}?includeHidden=1`, headers: headers(f.admin) })).json<{ comments: Comment[] }>().comments[0].status, 'hidden');
    assert.equal((await f.app.inject({ method: 'PATCH', url: `${url}/${comment.id}`, headers: headers(f.tester), payload: { body: 'try to bypass moderation' } })).statusCode, 409);
    assert.equal((await moderate(f.admin, 'visible')).statusCode, 200);
    await f.app.inject({ method: 'POST', url: `/api/admin/games/${game.id}/archive`, headers: headers(f.admin), payload: { archived: true } });
    assert.equal((await f.app.inject({ method: 'POST', url, headers: headers(f.admin), payload: { body: 'archived' } })).statusCode, 409);
    assert.equal((await f.app.inject({ url, headers: headers(f.tester) })).statusCode, 404);
    await f.restart();
    await f.app.inject({ method: 'POST', url: `/api/admin/games/${game.id}/archive`, headers: headers(f.admin), payload: { archived: false } });
    const restored = await f.app.inject({ url, headers: headers(f.tester) });
    assert.equal(restored.json<{ comments: Comment[] }>().comments[0].body, 'Feedback to moderate');
    assert.equal(restored.json<{ comments: Comment[] }>().comments[0].id, comment.id);
    const events = JSON.stringify(f.sqlite.prepare('SELECT * FROM audit_events').all());
    assert.ok(events.includes('comment.hide')); assert.ok(events.includes('comment.restore'));
    assert.ok(!events.includes('Feedback to moderate'));
  } finally { await f.close(); }
});

test('pagination is bounded and deterministic; game/author renames and restart preserve comment ownership', async () => {
  const f = await fixture();
  try {
    const game = await f.create('pages'); f.grant(f.tester, game);
    for (let index = 0; index < 25; index++) f.sqlite.prepare('INSERT INTO comments (id, game_id, author_user_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), game.id, f.tester.user.id, `Comment ${index}`, 1000 + index);
    const url = `/api/games/${game.slug}/comments`;
    const read = async (query: string) => (await f.app.inject({ url: `${url}${query}`, headers: headers(f.tester) })).json<{ comments: Comment[]; total: number }>();
    const first = await read('?offset=0&limit=5'); const second = await read('?offset=5&limit=5');
    assert.equal(first.total, 25); assert.equal(first.comments.length, 5);
    assert.ok(!first.comments.some(a => second.comments.some(b => a.id === b.id)));
    assert.deepEqual(first, await read('?offset=0&limit=5'));
    for (const query of ['?limit=0', '?limit=51', '?offset=-1', '?offset=no', '?includeHidden=true']) assert.equal((await f.app.inject({ url: `${url}${query}`, headers: headers(f.tester) })).statusCode, 400);
    f.sqlite.prepare('UPDATE users SET display_name = ? WHERE id = ?').run('New display name', f.tester.user.id);
    await f.app.inject({ method: 'PATCH', url: `/api/admin/games/${game.id}`, headers: headers(f.admin), payload: { title: 'Renamed', slug: 'new-pages' } });
    await f.restart();
    const renamed = (await f.app.inject({ url: '/api/games/new-pages/comments', headers: headers(f.tester) })).json<{ comments: Comment[]; total: number }>();
    assert.equal(renamed.total, 25); assert.equal(renamed.comments[0].authorId, f.tester.user.id);
    assert.equal(renamed.comments[0].authorName, 'New display name');
    assert.equal(renamed.comments[0].gameId, game.id);
  } finally { await f.close(); }
});

test('comment rate limit is shared across games and edits, but separate for different users', async () => {
  const f = await fixture();
  try {
    const first = await f.create('rate-first'); const second = await f.create('rate-second');
    f.grant(f.tester, first); f.grant(f.tester, second);
    let id = '';
    for (let index = 0; index < 10; index++) {
      const response = await f.app.inject({ method: 'POST', url: `/api/games/${index % 2 ? first.slug : second.slug}/comments`, headers: headers(f.tester), payload: { body: `Feedback ${index}` } });
      assert.equal(response.statusCode, 201, response.body); id = response.json<{ comment: Comment }>().comment.id;
    }
    const blocked = await f.app.inject({ method: 'PATCH', url: `/api/games/${first.slug}/comments/${id}`, headers: headers(f.tester), payload: { body: 'Edit still counts' } });
    assert.equal(blocked.statusCode, 429); assert.ok(blocked.headers['retry-after']);
    assert.equal((await f.app.inject({ method: 'POST', url: `/api/games/${first.slug}/comments`, headers: headers(f.admin), payload: { body: 'Other user on same IP' } })).statusCode, 201);
  } finally { await f.close(); }
});

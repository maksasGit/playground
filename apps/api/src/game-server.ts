import Fastify from 'fastify';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { openDatabase } from './database.js';
import { safeArtifactPath, type ArtifactFile } from './artifacts.js';

export function createGameServer(databasePath: string, storage: string, portalOrigin: string, gameOrigin: string) {
  const { sqlite } = openDatabase(databasePath);
  const app = Fastify({ logger: false });
  app.addHook('onClose', async () => { sqlite.close(); });
  app.get('/play/:ticket/:release/*', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer');
    const missing = () => reply.code(404).type('text/plain').send('Game file unavailable');
    if (request.headers.host !== new URL(gameOrigin).host) return missing();
    const { ticket, release, '*': name } = request.params as { ticket: string; release: string; '*': string };
    if (!/^[a-f0-9]{64}$/.test(ticket) || !/^[a-f0-9-]{36}$/.test(release)) return missing();
    const row = sqlite.prepare(`SELECT r.files_json FROM play_tickets t JOIN releases r ON r.id = t.release_id
      JOIN sessions s ON s.id = t.session_id JOIN users u ON u.id = t.user_id JOIN games g ON g.id = r.game_id
      WHERE t.token_hash = ? AND t.release_id = ? AND t.expires_at > ? AND s.expires_at > ? AND s.revoked_at IS NULL
      AND s.user_id = u.id AND u.status = 'active' AND u.must_change_password = 0 AND g.archived = 0
      AND (u.role = 'Admin' OR EXISTS (SELECT 1 FROM game_access a WHERE a.user_id = u.id AND a.game_id = g.id))`)
      .get(createHash('sha256').update(ticket).digest('hex'), release, Date.now(), Date.now()) as { files_json: string } | undefined;
    if (!row) return missing();
    try {
      safeArtifactPath(name);
      const files = JSON.parse(row.files_json) as Record<string, ArtifactFile>;
      if (!Object.hasOwn(files, name)) return missing();
      const root = await realpath(resolve(storage, 'releases', release));
      const file = await realpath(join(root, ...name.split('/')));
      if (!file.startsWith(root + sep)) return missing();
      reply.header('Content-Security-Policy', `default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; worker-src 'self' blob:; frame-ancestors ${portalOrigin}; base-uri 'self'; form-action 'none'`);
      return reply.type(files[name].mime).send(await readFile(file));
    } catch { return missing(); }
  });
  return app;
}

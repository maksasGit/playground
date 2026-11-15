import { resolve } from 'node:path';
import { config, root } from './config.js';
import { createApp } from './app.js';
import { createGameServer } from './game-server.js';
const database = resolve(root, config.DATABASE_PATH);
const storage = resolve(root, config.BUILDS_PATH);
const app = createApp(database, true, { origin: config.APP_ORIGIN, secureCookies: config.NODE_ENV === 'production' }, undefined, { storage, gameOrigin: config.GAME_ORIGIN });
const games = createGameServer(database, storage, config.APP_ORIGIN, config.GAME_ORIGIN);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close(); void games.close(); });
}
await app.listen({ host: config.HOST, port: config.PORT });
await games.listen({ host: config.GAME_HOST, port: config.GAME_PORT });

import { resolve } from 'node:path';
import { config, root } from './config.js';
import { createApp } from './app.js';
const app = createApp(resolve(root, config.DATABASE_PATH), true, { origin: config.APP_ORIGIN, secureCookies: config.NODE_ENV === 'production' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close(); });
}
await app.listen({ host: config.HOST, port: config.PORT });

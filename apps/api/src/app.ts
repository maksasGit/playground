import Fastify from 'fastify';
import { sql } from 'drizzle-orm';
import { healthSchema } from '@playground/shared';
import { openDatabase } from './database.js';

export function createApp(databasePath: string, logger = false) {
  const database = openDatabase(databasePath);
  const app = Fastify({ logger });
  app.get('/api/health', async () => {
    database.db.get(sql`SELECT 1`);
    return healthSchema.parse({ status: 'ok', database: 'ok' });
  });
  app.addHook('onClose', async () => { database.sqlite.close(); });
  return app;
}

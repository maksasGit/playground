import Fastify, { type FastifyError } from 'fastify';
import { sql } from 'drizzle-orm';
import { healthSchema } from '@playground/shared';
import { openDatabase } from './database.js';
import { ZodError } from 'zod';
import { accountRoutes, type AuthOptions } from './routes.js';

export function createApp(databasePath: string, logger = false, options: AuthOptions = { origin: 'http://127.0.0.1:5173', secureCookies: false }) {
  const database = openDatabase(databasePath);
  const app = Fastify({
    bodyLimit: 64 * 1024,
    logger: logger ? { redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'] } : false,
  });
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ message: 'Проверьте заполненные поля. Пароль: 12–128 символов; имя: 3–32 символа латиницей, цифры, _, . или -.' });
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return reply.code(409).send({ message: 'Такое имя пользователя уже занято.' });
    if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return reply.code(400).send({ message: 'Одна из выбранных игр не найдена.' });
    const status = error.statusCode ?? 500;
    if (status >= 500) request.log.error({ err: { name: error.name, code: error.code } }, 'Request failed');
    return reply.code(status).send({ message: status >= 500 ? 'Ошибка сервера.' : status === 429 ? 'Слишком много попыток. Попробуйте позже.' : error.message });
  });
  app.get('/api/health', async () => {
    database.db.get(sql`SELECT 1`);
    return healthSchema.parse({ status: 'ok', database: 'ok' });
  });
  app.register(async scope => { await accountRoutes(scope, database.sqlite, options); });
  app.addHook('onClose', async () => { database.sqlite.close(); });
  return app;
}

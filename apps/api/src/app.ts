import Fastify, { type FastifyError } from 'fastify';
import { sql } from 'drizzle-orm';
import { healthSchema } from '@playground/shared';
import { openDatabase } from './database.js';
import { ZodError } from 'zod';
import { accountRoutes, type AuthOptions } from './routes.js';
import { PublicGitHubClient, GitHubError, type GitHubReader } from './github.js';

export function createApp(databasePath: string, logger = false, options: AuthOptions = { origin: 'http://127.0.0.1:5173', secureCookies: false }, github: GitHubReader = new PublicGitHubClient()) {
  const database = openDatabase(databasePath);
  const app = Fastify({
    bodyLimit: 64 * 1024,
    logger: logger ? { redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'] } : false,
  });
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof GitHubError) {
      if (error.retryAfter) reply.header('Retry-After', error.retryAfter);
      return reply.code(error.statusCode).send({ message: error.message });
    }
    if (error instanceof ZodError) return reply.code(400).send({ message: 'Проверьте заполненные поля и ограничения длины.' });
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return reply.code(409).send({ message: 'Такое имя пользователя или адрес игры уже занят.' });
    if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return reply.code(400).send({ message: 'Одна из выбранных игр не найдена.' });
    if (error.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ message: 'Обложка должна быть не больше 5 МиБ.' });
    if (['FST_FILES_LIMIT', 'FST_FIELDS_LIMIT', 'FST_PARTS_LIMIT'].includes(error.code)) return reply.code(400).send({ message: 'Отправьте один файл обложки без дополнительных полей.' });
    const status = error.statusCode ?? 500;
    if (status >= 500) request.log.error({ err: { name: error.name, code: error.code } }, 'Request failed');
    return reply.code(status).send({ message: status >= 500 ? 'Ошибка сервера.' : status === 429 ? 'Слишком много попыток. Попробуйте позже.' : error.message });
  });
  app.get('/api/health', async () => {
    database.db.get(sql`SELECT 1`);
    return healthSchema.parse({ status: 'ok', database: 'ok' });
  });
  app.register(async scope => { await accountRoutes(scope, database.sqlite, options, github); });
  app.addHook('onClose', async () => { database.sqlite.close(); });
  return app;
}

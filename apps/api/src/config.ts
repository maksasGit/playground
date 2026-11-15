import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
export const root = fileURLToPath(new URL('../../../', import.meta.url));
dotenv.config({ path: resolve(root, '.env') });
export const envSchema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_PATH: z.string().min(1).default('./data/database/playground.sqlite'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ORIGIN: z.string().url().default('http://127.0.0.1:5173'),
  BUILDS_PATH: z.string().min(1).default('./data/builds'),
  GAME_ORIGIN: z.string().url().default('http://127.0.0.2:3003'),
  GAME_HOST: z.string().default('127.0.0.2'),
  GAME_PORT: z.coerce.number().int().min(1).max(65535).default(3003),
}).superRefine((value, context) => {
  const origin = new URL(value.APP_ORIGIN);
  if (origin.origin !== value.APP_ORIGIN || !['http:', 'https:'].includes(origin.protocol)) {
    context.addIssue({ code: 'custom', path: ['APP_ORIGIN'], message: 'APP_ORIGIN must be an exact HTTP(S) origin without a trailing slash.' });
  }
  if (value.NODE_ENV === 'production' && origin.protocol !== 'https:') {
    context.addIssue({ code: 'custom', path: ['APP_ORIGIN'], message: 'Production requires an HTTPS origin.' });
  }
  const game = new URL(value.GAME_ORIGIN);
  if (game.origin !== value.GAME_ORIGIN || !['http:', 'https:'].includes(game.protocol) || game.hostname === origin.hostname || (value.NODE_ENV === 'production' && game.protocol !== 'https:')) {
    context.addIssue({ code: 'custom', path: ['GAME_ORIGIN'], message: 'Games require a distinct hostname and an exact HTTP(S) origin; HTTPS is required in production.' });
  }
});
export const config = envSchema.parse(process.env);

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
});
export const config = envSchema.parse(process.env);

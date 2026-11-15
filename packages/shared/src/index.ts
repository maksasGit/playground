import { z } from 'zod';
export const healthSchema = z.object({
  status: z.literal('ok'),
  database: z.literal('ok'),
});
export type Health = z.infer<typeof healthSchema>;

export const roleSchema = z.enum(['Admin', 'Tester', 'Viewer']);
export const vaultPermissionSchema = z.enum(['vault:read', 'vault:upload', 'vault:manage']);
export const passwordSchema = z.string().min(12, 'Пароль: от 12 до 128 символов.').max(128);
export const usernameSchema = z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/).transform(value => value.toLowerCase());
export const userSchema = z.object({
  id: z.string(), username: z.string(), displayName: z.string(), role: roleSchema,
  status: z.enum(['active', 'disabled']), mustChangePassword: z.boolean(),
  gameIds: z.array(z.string()), vaultPermissions: z.array(vaultPermissionSchema),
});
export const sessionSchema = z.object({ user: userSchema, csrfToken: z.string() });
export const createUserSchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().max(80).default(''),
  password: passwordSchema,
  role: roleSchema,
  gameIds: z.array(z.string().uuid()).max(500).default([]),
  vaultPermissions: z.array(vaultPermissionSchema).default([]),
}).strict();
export const updateUserSchema = createUserSchema.omit({ username: true, password: true }).extend({
  status: z.enum(['active', 'disabled']),
}).strict();
export const gameSchema = z.object({
  id: z.string(), slug: z.string(), title: z.string(), description: z.string(),
  cover: z.string().nullable(), updatedAt: z.number(), canComment: z.boolean(),
  archived: z.boolean(), canModerate: z.boolean(),
  activeReleaseId: z.string().nullable(), deployedCommitSha: z.string().nullable(),
});
export const gameInputSchema = z.object({
  title: z.string().trim().min(1, 'Введите название игры.').max(100, 'Название: максимум 100 символов.'),
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Адрес: строчные латинские буквы, цифры и дефисы.'),
  description: z.string().trim().max(5000, 'Описание: максимум 5000 символов.').default(''),
}).strict();
export const commentInputSchema = z.object({
  body: z.string().trim().min(1, 'Напишите комментарий.').max(4000, 'Комментарий: максимум 4000 символов.'),
}).strict();
export const commentSchema = z.object({
  id: z.string(), gameId: z.string(), authorId: z.string(), authorName: z.string(),
  body: z.string(), createdAt: z.number(), editedAt: z.number().nullable(),
  status: z.enum(['visible', 'hidden']), canEdit: z.boolean(),
});
export const commentsPageSchema = z.object({
  comments: z.array(commentSchema), total: z.number(), offset: z.number(), limit: z.number(),
});
export type User = z.infer<typeof userSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Game = z.infer<typeof gameSchema>;
export type Role = z.infer<typeof roleSchema>;
export type Comment = z.infer<typeof commentSchema>;

export const repositoryUrlSchema = z.string().trim().max(250).refine(value => {
  const match = /^https:\/\/github\.com\/([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)\/([a-z0-9_.-]{1,100})\/?$/i.exec(value);
  if (!match) return false;
  const name = match[2].replace(/\.git$/i, '');
  return name !== '' && name !== '.' && name !== '..';
}, 'Вставьте ссылку вида https://github.com/owner/repository — на сам репозиторий.').transform(value => {
  const parts = value.replace(/\/$/, '').split('/');
  return `https://github.com/${parts[3]}/${parts[4].replace(/\.git$/i, '')}`;
});
export const repositoryInputSchema = z.object({ repositoryUrl: repositoryUrlSchema }).strict();
export const commitShaSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
export const repositorySchema = z.object({
  repositoryUrl: z.string(), branch: z.literal('main'),
  latestCommitSha: commitShaSchema.nullable(), commitMessage: z.string().nullable(),
  commitDate: z.string().nullable(), checkedAt: z.number().nullable(),
  deployedCommitSha: commitShaSchema.nullable(),
  status: z.enum(['not_checked', 'not_published', 'up_to_date', 'update_available']),
});
export type Repository = z.infer<typeof repositorySchema>;
export const buildRootSchema = z.string().trim().max(200).refine(value => value === '.' || (
  /^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(value) && !value.split('/').some(part => part === '.' || part === '..')
), 'Укажите . для корня репозитория или относительную папку, например needle-in-a-haystack.');
export const buildJobSchema = z.object({
  id: z.string(), gameId: z.string(), commitSha: z.string(), buildRoot: z.string(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed']),
  releaseId: z.string().nullable(), logs: z.string(), error: z.string().nullable(), createdAt: z.number(),
});
export const releaseSchema = z.object({ id: z.string(), commitSha: z.string(), createdAt: z.number(), size: z.number(), active: z.boolean() });
export const buildsSchema = z.object({
  workerReady: z.boolean(), workerMessage: z.string(),
  jobs: z.array(buildJobSchema), releases: z.array(releaseSchema),
});
export type BuildJob = z.infer<typeof buildJobSchema>;

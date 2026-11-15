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

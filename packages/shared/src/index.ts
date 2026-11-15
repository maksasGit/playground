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
});
export type User = z.infer<typeof userSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Game = z.infer<typeof gameSchema>;
export type Role = z.infer<typeof roleSchema>;

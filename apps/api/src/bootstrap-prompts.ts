import { passwordSchema, usernameSchema } from '@playground/shared';

export function validateBootstrapUsername(value: string): true | string {
  return usernameSchema.safeParse(value).success
    ? true
    : 'Имя: 3–32 символа, только латиница, цифры, точка, дефис или подчёркивание.';
}

export function validateBootstrapPassword(value: string): true | string {
  if (value.length < 12) return 'Пароль слишком короткий. Введите минимум 12 символов.';
  return passwordSchema.safeParse(value).success
    ? true
    : 'Пароль слишком длинный. Максимум 128 символов.';
}

export function validateBootstrapConfirmation(value: string, password: string): true | string {
  return value === password ? true : 'Пароли не совпадают. Повторите начальный пароль.';
}

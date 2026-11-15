import input from '@inquirer/input';
import passwordPrompt from '@inquirer/password';
import { stdin, stdout } from 'node:process';
import { resolve } from 'node:path';
import { config, root } from './config.js';
import { openDatabase } from './database.js';
import { createAccount } from './accounts.js';
import { validateBootstrapConfirmation, validateBootstrapPassword, validateBootstrapUsername } from './bootstrap-prompts.js';

const database = openDatabase(resolve(root, config.DATABASE_PATH));
try {
  if (database.sqlite.prepare('SELECT 1 FROM users LIMIT 1').get()) throw new Error('Настройка уже выполнена. Пользователи создаются в панели администратора.');
  if (!stdin.isTTY) throw new Error('Запустите команду в интерактивном терминале.');
  const username = await input({ message: 'Имя администратора (латиница, 3–32 символа):', validate: validateBootstrapUsername });
  const password = await passwordPrompt({ message: 'Начальный пароль (12–128 символов):', mask: '*', validate: validateBootstrapPassword });
  await passwordPrompt({ message: 'Повторите пароль:', mask: '*', validate: value => validateBootstrapConfirmation(value, password) });
  const user = await createAccount(database.sqlite, { username, password, role: 'Admin' }, null);
  stdout.write(`Администратор ${user.username} создан. При первом входе потребуется сменить пароль.\n`);
} catch (error) {
  console.error(error instanceof Error && error.name === 'ExitPromptError' ? 'Создание администратора отменено.'
    : error instanceof Error && error.name !== 'ZodError' ? error.message : 'Не удалось проверить данные администратора.');
  process.exitCode = 1;
} finally { database.sqlite.close(); }

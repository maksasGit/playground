import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { resolve } from 'node:path';
import { config, root } from './config.js';
import { openDatabase } from './database.js';
import { createAccount } from './accounts.js';

function hiddenPassword(label: string): Promise<string> {
  if (!stdin.isTTY) throw new Error('Запустите команду в интерактивном терминале.');
  stdout.write(label);
  return new Promise((resolvePassword, reject) => {
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stdout.write('\n');
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\u0003') { finish(); reject(new Error('Отменено.')); return; }
        if (char === '\r' || char === '\n') { finish(); resolvePassword(value); return; }
        if (char === '\u007f' || char === '\b') value = Array.from(value).slice(0, -1).join('');
        else if (char >= ' ') value += char;
      }
    };
    stdin.on('data', onData);
  });
}

const database = openDatabase(resolve(root, config.DATABASE_PATH));
try {
  if (database.sqlite.prepare('SELECT 1 FROM users LIMIT 1').get()) throw new Error('Настройка уже выполнена. Пользователи создаются в панели администратора.');
  const prompt = createInterface({ input: stdin, output: stdout });
  const username = await prompt.question('Имя администратора (латиница, 3–32 символа): ');
  prompt.close();
  const password = await hiddenPassword('Начальный пароль (не отображается, минимум 12 символов): ');
  const confirm = await hiddenPassword('Повторите пароль (не отображается): ');
  if (confirm !== password) throw new Error('Пароли не совпадают. Запустите команду ещё раз.');
  const user = await createAccount(database.sqlite, { username, password, role: 'Admin' }, null);
  stdout.write(`Администратор ${user.username} создан. При первом входе потребуется сменить пароль.\n`);
} catch (error) {
  console.error(error instanceof Error && error.name !== 'ZodError' ? error.message : 'Проверьте имя и длину пароля (12–128 символов).');
  process.exitCode = 1;
} finally { database.sqlite.close(); }

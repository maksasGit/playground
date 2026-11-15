import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('queue, publish, play across isolated origin, failed rebuild preserves release and rollback needs no rebuild', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Имя пользователя', { exact: true }).fill('editor');
  await page.getByLabel('Пароль', { exact: true }).fill('browser-test-editor-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('link', { name: '+ Добавить игру', exact: true }).click();
  await page.getByLabel('Название игры').fill('Build flow'); await page.getByLabel('Короткий адрес страницы').fill('build-flow');
  await page.getByRole('button', { name: 'Создать карточку', exact: true }).click();
  const source = page.getByRole('region', { name: 'Исходники на GitHub' });
  await source.getByLabel('Ссылка на GitHub').fill('https://github.com/build-team/public-game');
  await source.getByRole('button', { name: 'Подключить репозиторий' }).click();
  await expect(source.getByRole('status')).toContainText('Репозиторий подключён');
  const builds = page.getByRole('region', { name: 'Сборка и публикация' });
  await builds.getByRole('button', { name: 'Собрать и опубликовать', exact: true }).click();
  await expect(builds.getByText('Сейчас опубликована', { exact: true })).toHaveCount(1, { timeout: 15000 });
  await expect(source.getByText('Опубликована последняя версия')).toBeVisible();
  await page.getByRole('link', { name: 'Открыть страницу игры →' }).click();
  await page.getByRole('button', { name: 'Играть', exact: true }).click();
  const frame = page.frameLocator('iframe[title="Build flow"]');
  await expect(frame.locator('canvas')).toBeVisible();
  await expect(frame.locator('body')).toHaveAttribute('data-running', 'yes');
  const url = await page.locator('iframe').getAttribute('src'); expect(new URL(url!).hostname).toBe('127.0.0.2');
  await page.getByRole('link', { name: 'Редактировать игру', exact: true }).click();
  await builds.getByRole('button', { name: 'Собрать и опубликовать', exact: true }).click();
  await expect(builds.locator('.release-row')).toHaveCount(2, { timeout: 15000 });
  await builds.getByLabel('Папка проекта').fill('broken-project');
  await builds.getByRole('button', { name: 'Собрать и опубликовать', exact: true }).click();
  await expect(builds.getByText('Fixture build failed; previous release preserved')).toBeVisible({ timeout: 15000 });
  await expect(builds.getByText('Сейчас опубликована', { exact: true })).toHaveCount(1);
  await expect(builds.locator('.release-row')).toHaveCount(2);
  await builds.getByRole('button', { name: 'Откатить к этой версии' }).click();
  await expect(builds.getByRole('status')).toHaveText('Предыдущая версия опубликована без повторной сборки.');
  await expect(builds.locator('.release-row')).toHaveCount(2);
});

test('real needle Docker artifact loads WebGL and local assets in the protected iframe', async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_REAL_GAME !== '1', 'Run smoke-build.mts first, then set PLAYWRIGHT_REAL_GAME=1');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const badResponses: string[] = [];
  page.on('response', response => { if (response.url().startsWith('http://127.0.0.2:3004/') && response.status() >= 400) badResponses.push(`${response.status()} ${new URL(response.url()).pathname.split('/').slice(-1)[0]}`); });
  await page.goto('/');
  await page.getByLabel('Имя пользователя', { exact: true }).fill('editor');
  await page.getByLabel('Пароль', { exact: true }).fill('browser-test-editor-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.goto('/#/games/real-needle');
  await page.getByRole('button', { name: 'Играть', exact: true }).click();
  const frame = page.frameLocator('iframe[title="Needle — real container build"]');
  await expect(frame.locator('canvas')).toBeVisible({ timeout: 20000 });
  const manifest = JSON.parse(await readFile(resolve('data/m4-smoke/result.json'), 'utf8'));
  const playUrl = await page.locator('iframe').getAttribute('src');
  const base = playUrl!.slice(0, -'index.html'.length);
  for (const name of Object.keys(manifest.files)) {
    const asset = await page.request.get(base + name);
    expect(asset.status(), name).toBe(200);
  }
  await page.getByRole('button', { name: 'На весь экран' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName)).toBe('IFRAME');
  await page.evaluate(() => document.exitFullscreen());
  await page.screenshot({ path: 'test-results/needle-real-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/needle-real-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]); expect(badResponses).toEqual([]);
});

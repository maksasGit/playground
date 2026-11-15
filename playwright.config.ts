import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    { command: 'pnpm --filter @playground/api exec tsx ../../tests/server.mts', url: 'http://127.0.0.1:3002/api/health', reuseExistingServer: false },
    { command: 'pnpm --filter @playground/web exec vite --host 127.0.0.1 --port 5174 --strictPort', url: 'http://127.0.0.1:5174', env: { API_PROXY_TARGET: 'http://127.0.0.1:3002' }, reuseExistingServer: false },
  ],
});

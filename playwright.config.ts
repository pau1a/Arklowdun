import { defineConfig } from '@playwright/test';

const PORT = process.env.PLAYWRIGHT_PORT ?? '4173';
const HOST = process.env.PLAYWRIGHT_HOST ?? '127.0.0.1';
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://${HOST}:${PORT}`;

export default defineConfig({
  testDir: './tests',
  testMatch: ['a11y/*.spec.ts', 'ui/*.spec.ts', 'e2e/**/*.spec.ts'],
  fullyParallel: false,
  globalSetup: './tests/e2e/global.setup.ts',
  use: {
    baseURL,
    headless: true,
  },
  webServer: {
    command: `vite --mode test --host ${HOST} --port ${PORT}`,
    url: baseURL,
    env: {
      VITE_ENV: 'test',
      VITE_LOG_LEVEL: 'debug',
      VITE_IPC_ADAPTER: 'fake',
      VITE_IPC_SCENARIO: process.env.PLAYWRIGHT_SCENARIO ?? 'defaultHousehold',
      VITE_ROUTER_MODE: 'hash',
      PLAYWRIGHT_SCENARIO: process.env.PLAYWRIGHT_SCENARIO ?? 'defaultHousehold',
    },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

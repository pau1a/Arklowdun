import type { FullConfig } from '@playwright/test';

const DEFAULT_SCENARIO = 'defaultHousehold';
const FIXED_TIMESTAMP = '2024-06-01T12:00:00.000Z';

async function globalSetup(_config: FullConfig): Promise<void> {
  process.env.VITE_IPC_ADAPTER = 'fake';
  process.env.VITE_IPC_SCENARIO = process.env.PLAYWRIGHT_SCENARIO ?? DEFAULT_SCENARIO;
  process.env.VITE_IPC_FIXED_TIME = FIXED_TIMESTAMP;
  process.env.TZ = 'UTC';
  process.env.NODE_ENV ??= 'test';
}

export default globalSetup;

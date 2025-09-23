import type { Page } from '@playwright/test';
import type { DbHealthReport } from '/src/bindings/DbHealthReport';
import { STORE_MODULE_PATH } from './store';

export async function beginDbHealthCheck(page: Page): Promise<void> {
  await page.evaluate(
    async ({ storeModulePath }) => {
      const { actions } = await import(storeModulePath);
      actions.db.health.beginCheck();
    },
    { storeModulePath: STORE_MODULE_PATH },
  );
}

export async function setDbHealthReport(
  page: Page,
  report: DbHealthReport,
): Promise<void> {
  await page.evaluate(
    async ({ storeModulePath, payload }) => {
      const { actions } = await import(storeModulePath);
      actions.db.health.receive(payload);
    },
    { storeModulePath: STORE_MODULE_PATH, payload: report },
  );
}

export async function resetDbHealth(page: Page): Promise<void> {
  const okReport: DbHealthReport = {
    status: 'ok',
    checks: [],
    offenders: [],
    schema_hash: 'playwright',
    app_version: 'playwright',
    generated_at: new Date().toISOString(),
  };
  await page.evaluate(
    async ({ storeModulePath, payload }) => {
      const { actions } = await import(storeModulePath);
      actions.db.health.clearError();
      actions.db.health.receive(payload);
    },
    { storeModulePath: STORE_MODULE_PATH, payload: okReport },
  );
}

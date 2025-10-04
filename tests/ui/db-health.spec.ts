import { expect, test } from '@playwright/test';
import type { DbHealthReport } from '/src/bindings/DbHealthReport';
import {
  beginDbHealthCheck,
  resetDbHealth,
  setDbHealthReport,
} from '../support/dbHealth';
import { settingsInitStub } from '../support/tauri-stubs';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(settingsInitStub);
});

test.describe('Database health banner', () => {
  test('shows spinner and renders drawer details', async ({ page }) => {
    await page.goto('/#/dashboard');
    await resetDbHealth(page);

    const banner = page.locator('[data-ui="db-health-banner"]');
    await expect(banner).toBeHidden();

    await beginDbHealthCheck(page);
    await expect(banner).toBeVisible();
    await expect(banner.locator('.db-health-banner__spinner')).toBeVisible();
    await expect(banner).toContainText('Re-checking database health');

    const generatedAt = new Date('2024-05-02T09:30:00Z').toISOString();
    const report: DbHealthReport = {
      status: 'error',
      checks: [
        { name: 'quick_check', passed: true, duration_ms: 5 },
        {
          name: 'foreign_key_check',
          passed: false,
          duration_ms: 3,
          details: '1 foreign key violation(s)',
        },
      ],
      offenders: [
        { table: 'events', rowid: 7, message: 'missing household id' },
      ],
      schema_hash: 'playwright-hash',
      app_version: 'playwright',
      generated_at: generatedAt,
    };

    await setDbHealthReport(page, report);

    await expect(banner.locator('.db-health-banner__spinner')).toBeHidden();
    await expect(banner).toContainText('Database health issues');

    await banner.getByRole('button', { name: 'View details' }).click();

    const drawer = page.locator('[data-ui="db-health-drawer"]');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('Needs attention');
    await expect(
      drawer.getByRole('button', { name: 'Re-run health check' }),
    ).toBeEnabled();
    await expect(drawer).toContainText('missing household id');

    await drawer.getByRole('button', { name: 'Close' }).click();
    await expect(drawer).toBeHidden();
  });
});

import { expect, test } from '@playwright/test';
import { settingsInitStub } from '../support/tauri-stubs';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(settingsInitStub);
});

test.describe('Files view triad', () => {
  test('cycles through loading, empty, error, and data states', async ({ page }) => {
    await page.goto('/#/files');

    const loading = page.locator('[data-ui="loading"]');
    await expect(loading).toBeVisible();

    await page.evaluate(async () => {
      const { actions } = await import('/src/store/index.ts');
      actions.files.updateSnapshot({
        items: [],
        ts: Date.now(),
        path: '.',
      });
    });

    const emptyState = page.locator('.files__panel [data-ui="empty-state"]');
    await expect(emptyState).toBeVisible();
    await expect(loading).toBeHidden();

    await page.evaluate(async () => {
      const { emit } = await import('/src/store/events.ts');
      emit('files:load-error', {
        message: 'Unable to load test files',
        detail: 'network unreachable',
      });
    });

    const errorBanner = page.locator('[data-ui="error-banner"]');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText('Unable to load test files');

    await page.evaluate(async () => {
      const { actions } = await import('/src/store/index.ts');
      actions.files.updateSnapshot({
        items: [{ name: 'report.pdf', isDirectory: false }],
        ts: Date.now(),
        path: '.',
      });
    });

    await expect(errorBanner).toHaveCount(0);
    const rows = page.locator('.files__table tbody tr');
    await expect(rows.first()).toContainText('report.pdf');
  });
});

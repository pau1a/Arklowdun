import { expect, test } from '@playwright/test';
import { gotoAppRoute } from '../../support/appReady';
import { settingsInitStub } from '../../support/tauri-stubs';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(settingsInitStub);
});

test('export list button surfaces success toast', async ({ page }) => {
  await gotoAppRoute(page, '/#/settings#settings-storage');

  const exportButton = page.getByRole('button', { name: 'Export list' });
  await expect(exportButton).toBeVisible();

  await exportButton.click();

  const toast = page
    .locator('#ui-toast-region .toast')
    .filter({ hasText: 'Exported manifest to' });
  await expect(toast).toBeVisible();
});

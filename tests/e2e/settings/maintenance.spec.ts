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

test('move failure surfaces friendly toast', async ({ page }) => {
  await gotoAppRoute(page, '/#/settings#settings-storage');

  await page.evaluate(() => {
    const current = window.__ARKLOWDUN_FIXTURE__ ?? {};
    window.__ARKLOWDUN_FIXTURE__ = {
      ...current,
      maintenance: {
        ...(current.maintenance ?? {}),
        move: { errorCode: 'FILE_MISSING' },
      },
    };
  });

  await page.locator('#storage-maintenance-household').fill('hh-1');
  const moveGroup = page
    .locator('.storage__maintenance-group')
    .filter({ has: page.getByRole('heading', { name: 'Move or rename' }) });
  await moveGroup.locator('select').nth(0).selectOption('bills');
  await moveGroup.getByPlaceholder('From relative path').fill('old.pdf');
  await moveGroup.locator('select').nth(1).selectOption('policies');
  await moveGroup.getByPlaceholder('To relative path').fill('new.pdf');

  await page.getByRole('button', { name: 'Move file' }).click();

  const toast = page
    .locator('#ui-toast-region .toast')
    .filter({ hasText: 'The source file is missing from the vault.' });
  await expect(toast).toBeVisible();
});

test('scan cancel path shows cancellation status', async ({ page }) => {
  await gotoAppRoute(page, '/#/settings#settings-storage');

  await page.evaluate(() => {
    const current = window.__ARKLOWDUN_FIXTURE__ ?? {};
    window.__ARKLOWDUN_FIXTURE__ = {
      ...current,
      maintenance: {
        ...(current.maintenance ?? {}),
        repair: {
          ...(current.maintenance?.repair ?? {}),
          delayMs: 100,
          scanned: 8,
          missing: 3,
        },
      },
    };
  });

  await page.locator('#storage-maintenance-household').fill('hh-1');

  await page.getByRole('button', { name: 'Scan for missing attachments' }).click();

  const cancelButton = page.getByRole('button', { name: 'Cancel' });
  await expect(cancelButton).toBeEnabled();
  await cancelButton.click();

  const requestToast = page
    .locator('#ui-toast-region .toast')
    .filter({ hasText: 'Cancellation requested.' });
  await expect(requestToast).toBeVisible();

  const cancelledToast = page
    .locator('#ui-toast-region .toast')
    .filter({ hasText: 'Repair run cancelled.' });
  await expect(cancelledToast).toBeVisible();

  const status = page
    .locator('.storage__maintenance-status')
    .filter({ hasText: 'Cancelled' })
    .first();
  await expect(status).toContainText('Cancelled after scanning 8');
  await expect(cancelButton).toBeDisabled();
});

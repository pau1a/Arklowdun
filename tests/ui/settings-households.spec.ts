import { expect, test } from '@playwright/test';
import { gotoAppRoute } from '../support/appReady';
import { settingsInitStub } from '../support/tauri-stubs';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(settingsInitStub);
});

test.describe('Settings households lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAppRoute(page, '/#/settings');
    await expect(page.getByRole('button', { name: 'Create household' })).toBeVisible();
  });

  test('create, rename, delete, and restore a household', async ({ page }) => {
    await page.getByRole('button', { name: 'Create household' }).click();
    await page.getByPlaceholder('Household name').fill('Secondary household');
    await page.locator('.settings__household-color').nth(1).click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    const row = page
      .locator('.settings__household-row')
      .filter({ hasText: 'Secondary household' });
    const rowId = await row.first().getAttribute('data-household-id');
    expect(rowId).toBeTruthy();
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Rename' }).click();
    await row.locator('.settings__household-edit .settings__household-input').fill('Guest suite');
    await row.getByRole('button', { name: 'Save' }).click();
    const renamedRow = page.locator(
      `.settings__household-row[data-household-id="${rowId}"]`,
    );
    await expect(renamedRow).toContainText('Guest suite');

    page.once('dialog', (dialog) => dialog.accept());
    await renamedRow.getByRole('button', { name: 'Delete' }).click();

    await page.locator('[data-ui="switch"]').click();
    const deletedRow = page
      .locator('.settings__household-deleted .settings__household-row')
      .filter({ hasText: 'Guest suite' });
    await expect(deletedRow).toBeVisible();
    await expect(deletedRow.locator('.settings__household-badge--deleted')).toBeVisible();

    await deletedRow.getByRole('button', { name: 'Restore' }).click();
    await expect(
      page
        .locator('.settings__household-list .settings__household-row')
        .filter({ hasText: 'Guest suite' }),
    ).toBeVisible();
  });

  test('colour selection updates chip and failed saves surface validation', async ({ page }) => {
    const defaultRow = page
      .locator('.settings__household-row')
      .filter({ hasText: 'Default household' });
    const chip = defaultRow.locator('.settings__household-chip');

    await defaultRow.getByRole('button', { name: 'Rename' }).click();
    await defaultRow.getByRole('button', { name: 'Use colour #F59E0B' }).click();
    await defaultRow.getByRole('button', { name: 'Save' }).click();

    await expect(chip).not.toHaveClass(/settings__household-chip--empty/);
    await expect(chip).toHaveAttribute('title', 'Colour #F59E0B');
    const storedColour = await chip.evaluate((node) =>
      node.style.getPropertyValue('--household-color'),
    );
    expect(storedColour).toBe('#F59E0B');
    const contrastAttr = await chip.getAttribute('data-contrast');
    expect(contrastAttr).toBeTruthy();

    await defaultRow.getByRole('button', { name: 'Rename' }).click();
    await defaultRow.getByRole('button', { name: 'Use colour #EF4444' }).click();

    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__ = {
        ...window.__TAURI_INTERNALS__,
        invoke(cmd, args) {
          if (cmd === 'household_update') {
            return Promise.reject({ code: 'INVALID_COLOR' });
          }
          return original(cmd, args);
        },
        __restore: original,
      };
    });

    await defaultRow.getByRole('button', { name: 'Save' }).click();

    const errorMessage = defaultRow.locator('.settings__household-error');
    await expect(errorMessage).toBeVisible();
    await expect(errorMessage).toHaveText('Please use a hex colour like #2563EB.');
    await expect(defaultRow.locator('.settings__household-color-picker')).toHaveAttribute(
      'data-invalid',
      'true',
    );
    const toast = page
      .locator('#ui-toast-region .toast')
      .filter({ hasText: 'Please use a hex colour like #2563EB.' });
    await expect(toast).toBeVisible();
    await expect(defaultRow.locator('.settings__household-edit')).toBeVisible();

    await page.evaluate(() => {
      const restore = window.__TAURI_INTERNALS__.__restore;
      if (restore) {
        window.__TAURI_INTERNALS__.invoke = restore;
        delete window.__TAURI_INTERNALS__.__restore;
      }
    });
  });

  test('deleting the active household falls back to default', async ({ page }) => {
    await page.getByRole('button', { name: 'Create household' }).click();
    await page.getByPlaceholder('Household name').fill('Temporary');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    const tempRow = page
      .locator('.settings__household-row')
      .filter({ hasText: 'Temporary' });
    await tempRow.getByRole('button', { name: 'Set active' }).click();
    await expect(tempRow.locator('.settings__household-badge--active')).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await tempRow.getByRole('button', { name: 'Delete' }).click();

    const defaultRow = page
      .locator('.settings__household-row')
      .filter({ hasText: 'Default household' });
    await expect(defaultRow.locator('.settings__household-badge--active')).toBeVisible();
  });

  test('default household delete control is visibly disabled', async ({ page }) => {
    const defaultRow = page
      .locator('.settings__household-row')
      .filter({ hasText: 'Default household' });
    const deleteButton = defaultRow.getByRole('button', { name: 'Delete' });

    await expect(deleteButton).toBeDisabled();
    await expect(deleteButton).toHaveAttribute(
      'title',
      'Default household cannot be deleted.',
    );
    await expect(deleteButton).toHaveAttribute('aria-disabled', 'true');
    await expect(deleteButton).toHaveClass(/is-disabled/);
  });
});

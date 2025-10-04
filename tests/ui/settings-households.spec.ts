import { expect, test } from '@playwright/test';
import { settingsInitStub } from '../support/tauri-stubs';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(settingsInitStub);
});

test.describe('Settings households lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/settings');
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

import { expect, test } from '@playwright/test';
import { settingsInitStub } from '../../support/tauri-stubs';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(settingsInitStub);
});

test.describe('Settings navigation', () => {
  test('deep link focuses diagnostics and remembers last section', async ({ page }) => {
    await page.goto('/#/settings#settings-about');

    const nav = page.getByTestId('settings-nav');
    await expect(nav).toBeVisible();

    const diagnosticsLink = page.getByTestId('settings-nav-settings-about');
    await expect(diagnosticsLink).toHaveAttribute('aria-current', 'true');

    await expect(
      page.getByRole('button', { name: 'Copy diagnostics summary' }),
    ).toBeFocused();

    const notificationsLink = page.getByTestId('settings-nav-settings-notifications');
    await notificationsLink.click();

    await expect(notificationsLink).toHaveAttribute('aria-current', 'true');

    await page.reload();
    await expect(page.getByTestId('settings-nav')).toBeVisible();
    await expect(
      page.getByTestId('settings-nav-settings-notifications'),
    ).toHaveAttribute('aria-current', 'true');

    await expect(page.locator('#settings-notifications')).toBeVisible();
  });

  test('default household delete guard surfaces toast and keeps health green', async ({ page }) => {
    await page.goto('/#/settings#settings-household');

    const defaultRow = page
      .locator('.settings__household-row')
      .filter({ hasText: 'Default household' });
    const deleteButton = defaultRow.getByRole('button', { name: 'Delete' });

    await expect(deleteButton).toBeDisabled();

    await deleteButton.evaluate((button: HTMLButtonElement) => {
      button.disabled = false;
      button.removeAttribute('aria-disabled');
    });

    const statusLine = page.locator('.settings__household-status');
    const initialStatus = await statusLine.textContent();

    page.once('dialog', (dialog) => dialog.accept());
    await deleteButton.click();

    const errorToast = page
      .locator('#ui-toast-region .toast')
      .filter({ hasText: 'The default household cannot be deleted.' });
    await expect(errorToast).toBeVisible();

    if (initialStatus && initialStatus.trim().length > 0) {
      await expect(statusLine).toHaveText(initialStatus);
    } else {
      await expect(statusLine).not.toContainText('Resolve database health issues');
    }

    const healthBanner = page.locator('[data-ui="db-health-banner"]');
    await expect(healthBanner).toHaveAttribute('data-state', 'healthy');
  });
});

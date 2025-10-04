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
});

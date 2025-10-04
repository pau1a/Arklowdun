import { test } from '@playwright/test';
import { settingsInitStub } from '../support/tauri-stubs';
import { expectNoAxeViolations } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(settingsInitStub);
});

test.describe('axe smoke', () => {
  test('calendar view has no accessibility violations', async ({ page }) => {
    await expectNoAxeViolations(page, '/#/calendar');
  });
});

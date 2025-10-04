import { expect, test } from '@playwright/test';
import { gotoAppRoute } from '../support/appReady';
import { settingsInitStub } from '../support/tauri-stubs';

const NOTE_TEMPLATE = {
  id: 'note-e2e',
  text: 'Sample',
  color: '#FFF4B8',
  x: 12,
  y: 18,
  z: 1,
  position: 0,
  household_id: 'test-household',
  created_at: Date.now(),
  updated_at: Date.now(),
  deleted_at: null,
};

test.describe('Pane primitives', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(settingsInitStub);
  });

  test('calendar form is built from primitives', async ({ page }) => {
    await gotoAppRoute(page, '/#/calendar');

    const form = page.locator('.calendar__form');
    await expect(form).toBeVisible();

    await expect(form.locator('input:not([data-ui="input"])')).toHaveCount(0);
    await expect(form.locator('button:not([data-ui="button"])')).toHaveCount(0);
  });

  test('notes controls rely on primitives', async ({ page }) => {
    await gotoAppRoute(page, '/#/notes');
    await page.waitForSelector('#notes-canvas');

    await page.evaluate(async (note) => {
      const { actions } = await import('/src/store/index.ts');
      actions.notes.updateSnapshot({
        items: [note],
        ts: Date.now(),
        source: 'playwright-test',
      });
    }, NOTE_TEMPLATE);

    const noteCard = page.locator('.notes-canvas .note').first();
    await expect(noteCard).toBeVisible();
    await expect(noteCard.locator('button:not([data-ui="button"])')).toHaveCount(0);
  });

  test('settings diagnostics controls use Button primitive', async ({ page }) => {
    await gotoAppRoute(page, '/#/settings');

    const settings = page.locator('.settings');
    await expect(settings).toBeVisible();

    const actions = settings.locator('.settings__actions');
    await expect(actions.locator('button[data-ui="button"]')).toHaveCount(2);
    await expect(actions.locator('button:not([data-ui="button"])')).toHaveCount(0);
  });
});

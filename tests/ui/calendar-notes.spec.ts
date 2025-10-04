import { expect, test } from '@playwright/test';

import { createUtcEvents, seedCalendarSnapshot } from '../support/calendar';
import { STORE_MODULE_PATH } from '../support/store';
import { settingsInitStub } from '../support/tauri-stubs';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(settingsInitStub);
});

test.describe('Calendar contextual notes', () => {
  test('quick capture resolves categories on demand', async ({ page }) => {
    const now = Date.now();
    const [event] = createUtcEvents({
      baseTs: now,
      count: 1,
      idSeed: 'evt-quick-capture',
      appendIndex: false,
      titlePrefix: 'Planning session',
    });

    await page.goto('/#/calendar');

    const windowRange = {
      start: now - 24 * 60 * 60 * 1000,
      end: now + 24 * 60 * 60 * 1000,
    };

    await seedCalendarSnapshot(page, {
      events: [event],
      truncated: false,
      ts: now + 1_000,
      window: windowRange,
      source: 'playwright-calendar-notes',
    });

    await page.waitForSelector('.calendar__surface');

    await page.evaluate(
      async ({ storeModulePath, eventId }) => {
        const categoriesModule = await import('/src/repos.ts');
        let categoryFetchCount = 0;
        categoriesModule.categoriesRepo.list = async (options) => {
          categoryFetchCount += 1;
          (window as any).__calendarCategoryFetchCount = categoryFetchCount;
          return [
            {
              id: 'cat_primary',
              name: 'Primary',
              slug: 'primary',
              color: '#4F46E5',
              household_id: options.householdId,
              position: 0,
              z: 0,
              is_visible: true,
              created_at: Date.now(),
              updated_at: Date.now(),
              deleted_at: null,
            },
          ];
        };

        const categoriesStore = await import('/src/store/categories.ts');
        categoriesStore.__resetCategories();

        const householdModule = await import('/src/db/household.ts');
        householdModule.getHouseholdIdForCalls = async () => 'hh-playwright';

        const notesRepoModule = await import('/src/repos/contextNotesRepo.ts');
        notesRepoModule.contextNotesRepo.listForEntity = async () => ({
          notes: [],
          links: [],
          next_cursor: null,
        });
        notesRepoModule.contextNotesRepo.quickCreate = async (options) => {
          (window as any).__calendarQuickCaptureOptions = options;
          const timestamp = Date.now();
          return {
            id: 'note-quick-capture',
            household_id: options.householdId,
            category_id: options.categoryId,
            position: 0,
            created_at: timestamp,
            updated_at: timestamp,
            text: options.text,
            color: options.color ?? '#FFF4B8',
            x: 0,
            y: 0,
          };
        };
        notesRepoModule.contextNotesRepo.getLinkForNote = async (_, noteId) => ({
          id: 'link-quick-capture',
          household_id: 'hh-playwright',
          note_id: noteId,
          entity_type: 'event',
          entity_id: eventId,
          relation: 'primary',
          created_at: Date.now(),
          updated_at: Date.now(),
        });
      },
      { storeModulePath: STORE_MODULE_PATH, eventId: event.id },
    );

    const eventRow = page.locator('.calendar__event', { hasText: 'Planning session' });
    await expect(eventRow).toBeVisible();
    await eventRow.click();

    const panel = page.locator('.calendar-notes-panel');
    await expect(panel).toBeVisible();

    const quickInput = panel.locator('.calendar-notes-panel__input');
    await quickInput.fill('Prep agenda for kickoff');
    await panel.locator('.calendar-notes-panel__submit').click();

    await expect.poll(async () => {
      return page.evaluate(() => (window as any).__calendarCategoryFetchCount ?? 0);
    }).toBe(1);

    const noteItem = panel.locator('.calendar-notes-panel__item').first();
    await expect(noteItem).toContainText('Prep agenda for kickoff');

    await expect(panel.locator('.calendar-notes-panel__error')).toBeHidden();

    const quickOptions = await page.evaluate(() => (window as any).__calendarQuickCaptureOptions);
    expect(quickOptions?.categoryId).toBe('cat_primary');
  });
});

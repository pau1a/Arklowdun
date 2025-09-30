import { expect, test } from '@playwright/test';

import { createUtcEvents, seedCalendarSnapshot } from '../support/calendar';

const persistSource = 'playwright-calendar-notes-persist';

test.describe('Calendar contextual notes persistence', () => {
  test('snapshot events are persisted before notes load and quick capture', async ({ page }) => {
    const now = Date.now();
    const [event] = createUtcEvents({
      baseTs: now,
      count: 1,
      idSeed: 'evt-persist',
      appendIndex: false,
      titlePrefix: 'Snapshot planning',
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
      source: persistSource,
    });

    await page.waitForSelector('.calendar__surface');

    await page.evaluate(
      async ({ eventId }) => {
        const callModule = await import('/src/lib/ipc/call.ts');
        let persistCount = 0;
        callModule.call = async (command: string, payload: any) => {
          if (command === 'get_default_household_id') {
            return 'hh-playwright';
          }
          if (command === 'event_create') {
            persistCount += 1;
            (window as any).__calendarEventPersistCalls = persistCount;
            if (persistCount > 1) {
              throw new Error('UNIQUE constraint failed: events.id');
            }
            return null;
          }
          return null;
        };

        const categoriesModule = await import('/src/repos.ts');
        categoriesModule.categoriesRepo.list = async ({ householdId }: { householdId: string }) => [
          {
            id: 'cat_primary',
            name: 'Primary',
            slug: 'primary',
            color: '#4F46E5',
            household_id: householdId,
            position: 0,
            z: 0,
            is_visible: true,
            created_at: Date.now(),
            updated_at: Date.now(),
            deleted_at: null,
          },
        ];

        const categoriesStore = await import('/src/store/categories.ts');
        categoriesStore.__resetCategories();

        const notesRepoModule = await import('/src/repos/contextNotesRepo.ts');
        notesRepoModule.contextNotesRepo.listForEntity = async () => ({
          notes: [],
          links: [],
          next_cursor: null,
        });
        notesRepoModule.contextNotesRepo.quickCreate = async (options) => {
          (window as any).__calendarQuickCreatePersist = options;
          const timestamp = Date.now();
          return {
            id: 'note-persist',
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
          id: 'link-persist',
          household_id: 'hh-playwright',
          note_id: noteId,
          entity_type: 'event',
          entity_id: eventId,
          relation: 'primary',
          created_at: Date.now(),
          updated_at: Date.now(),
        });
      },
      { eventId: event.id },
    );

    const eventRow = page.locator('.calendar__event', { hasText: 'Snapshot planning' });
    await expect(eventRow).toBeVisible();
    await eventRow.click();

    const panel = page.locator('.calendar-notes-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.calendar-notes-panel__error')).toBeHidden();

    await expect.poll(async () => {
      return page.evaluate(() => (window as any).__calendarEventPersistCalls ?? 0);
    }).toBe(1);

    const quickInput = panel.locator('.calendar-notes-panel__input');
    await quickInput.fill('Document the snapshot event');
    await panel.locator('.calendar-notes-panel__submit').click();

    const noteItem = panel.locator('.calendar-notes-panel__item').first();
    await expect(noteItem).toContainText('Document the snapshot event');
    await expect(panel.locator('.calendar-notes-panel__error')).toBeHidden();

    await expect.poll(async () => {
      return page.evaluate(() => (window as any).__calendarEventPersistCalls ?? 0);
    }).toBe(2);

    const quickOptions = await page.evaluate(() => (window as any).__calendarQuickCreatePersist);
    expect(quickOptions?.entityId).toBe(event.id);
    expect(quickOptions?.text).toBe('Document the snapshot event');
  });
});

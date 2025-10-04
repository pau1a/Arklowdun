import { expect, test } from '@playwright/test';

import { createUtcEvents, seedCalendarSnapshot } from '../support/calendar';
import { STORE_MODULE_PATH } from '../support/store';
import { settingsInitStub } from '../support/tauri-stubs';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(settingsInitStub);
});

test.describe('Timezone badge integrations', () => {
  test('shows in calendar notes panel for cross-timezone events', async ({ page }) => {
    await page.goto('/#/calendar');

    // Place the event near "now" so the default calendar view renders it.
    const eventStart = Date.now();
    const calendarWindow = {
      start: eventStart - 24 * 60 * 60 * 1000,
      end: eventStart + 24 * 60 * 60 * 1000,
    };
    const [crossZoneEvent] = createUtcEvents({
      baseTs: eventStart,
      count: 1,
      idSeed: 'evt-test',
      titlePrefix: 'Cross-zone call',
      appendIndex: false,
      durationMs: 60 * 60 * 1000,
      householdId: 'hh-test',
      tz: 'America/New_York',
    });

    await seedCalendarSnapshot(page, {
      events: [crossZoneEvent],
      truncated: false,
      ts: eventStart + 1_000,
      window: calendarWindow,
      source: 'playwright-timezone-test',
    });

    // Calendar tiles don’t expose button semantics; use the rendered class selector.
    const eventRow = page.locator('.calendar__event', { hasText: 'Cross-zone call' });
    await expect(eventRow).toBeVisible();
    await eventRow.click();

    const panel = page.locator('.calendar-notes-panel');
    await expect(panel).toBeVisible();
    const badge = panel.locator('.calendar-notes-panel__event-meta [data-ui="timezone-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('America/New_York');

    await page.locator('.calendar__notes-toggle').click();
  });

  test('appears for note deadlines when timezone differs', async ({ page }) => {
    await page.goto('/#/notes');

    const noteSeed = Date.UTC(2024, 5, 13, 16, 30, 0);
    const noteSnapshotTs = noteSeed + 2_000;
    const noteDeadline = noteSeed + 2 * 24 * 60 * 60 * 1000;
    const note = {
      id: 'note-deadline-1',
      text: 'Submit quarterly report',
      color: '#FFF4B8',
      x: 16,
      y: 24,
      z: 0,
      position: 0,
      household_id: 'hh-test',
      created_at: noteSeed,
      updated_at: noteSeed,
      deadline: noteDeadline,
      deadline_tz: 'America/Los_Angeles',
    };

    await page.evaluate(
      async ({ noteData, snapshotTs, storeModulePath }) => {
        const { actions } = await import(storeModulePath);
        actions.notes.updateSnapshot({
          items: [noteData],
          ts: snapshotTs,
        });
      },
      { noteData: note, snapshotTs: noteSnapshotTs, storeModulePath: STORE_MODULE_PATH },
    );

    const badge = page.locator('.notes__deadline-panel [data-ui="timezone-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('America/Los_Angeles');
  });

  test('files reminder detail surfaces timezone badge', async ({ page }) => {
    await page.goto('/#/files');

    const reminderSeed = Date.UTC(2024, 5, 14, 12, 0, 0);
    const reminderDue = reminderSeed + 7 * 24 * 60 * 60 * 1000;

    await page.evaluate(
      async ({ reminderTs, entry, storeModulePath }) => {
        const { actions } = await import(storeModulePath);
        actions.files.updateSnapshot({
          items: [entry],
          ts: reminderTs,
          path: '.',
        });
      },
      {
        reminderTs: reminderSeed + 1_000,
        entry: {
          name: 'policy-renewal.pdf',
          isDirectory: false,
          reminder: reminderDue,
          reminder_tz: 'America/Chicago',
        },
        storeModulePath: STORE_MODULE_PATH,
      },
    );

    const row = page.locator('.files__table tbody tr').first();
    await expect(row).toBeVisible();
    await row.click();

    const badge = page.locator('.files__reminder-detail [data-ui="timezone-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('America/Chicago');
  });
});

import { expect, test } from '@playwright/test';

test.describe('Timezone badge integrations', () => {
  test('shows in calendar event modal for cross-timezone events', async ({ page }) => {
    await page.goto('/#/calendar');

    await page.evaluate(async () => {
      const { actions } = await import('/src/store/index.ts');
      const now = Date.now();
      const event = {
        id: 'evt-test-1',
        household_id: 'hh-test',
        title: 'Cross-zone call',
        start_at: now,
        end_at: now + 60 * 60 * 1000,
        start_at_utc: now,
        end_at_utc: now + 60 * 60 * 1000,
        tz: 'America/New_York',
        reminder: null,
        created_at: now,
        updated_at: now,
      } as const;
      actions.events.updateSnapshot({
        items: [event],
        ts: Date.now(),
        window: { start: now - 24 * 60 * 60 * 1000, end: now + 24 * 60 * 60 * 1000 },
        truncated: false,
      });
    });

    const eventRow = page.locator('.calendar__event', { hasText: 'Cross-zone call' });
    await expect(eventRow).toBeVisible();
    await eventRow.click();

    const badge = page.locator('.calendar__event-modal [data-ui="timezone-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('America/New_York');

    await page.keyboard.press('Escape');
  });

  test('appears for note deadlines when timezone differs', async ({ page }) => {
    await page.goto('/#/notes');

    await page.evaluate(async () => {
      const { actions } = await import('/src/store/index.ts');
      const now = Date.now();
      const note = {
        id: 'note-deadline-1',
        text: 'Submit quarterly report',
        color: '#FFF4B8',
        x: 16,
        y: 24,
        z: 0,
        position: 0,
        household_id: 'hh-test',
        created_at: now,
        updated_at: now,
        deleted_at: null,
        deadline: now + 2 * 24 * 60 * 60 * 1000,
        deadline_tz: 'America/Los_Angeles',
      } as const;
      actions.notes.updateSnapshot({
        items: [note],
        ts: Date.now(),
      });
    });

    const badge = page.locator('.notes__deadline-panel [data-ui="timezone-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('America/Los_Angeles');
  });

  test('files reminder detail surfaces timezone badge', async ({ page }) => {
    await page.goto('/#/files');

    await page.evaluate(async () => {
      const { actions } = await import('/src/store/index.ts');
      const now = Date.now();
      actions.files.updateSnapshot({
        items: [
          {
            name: 'policy-renewal.pdf',
            isDirectory: false,
            reminder: now + 7 * 24 * 60 * 60 * 1000,
            reminder_tz: 'America/Chicago',
          },
        ],
        ts: Date.now(),
        path: '.',
      });
    });

    const row = page.locator('.files__table tbody tr').first();
    await expect(row).toBeVisible();
    await row.click();

    const badge = page.locator('.files__reminder-detail [data-ui="timezone-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('America/Chicago');
  });
});

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

async function updateCalendarSnapshot(
  page: Page,
  options: { count: number; truncated: boolean; ts: number },
) {
  await page.evaluate(async ({ count, truncated, ts }) => {
    const { actions } = await import('/src/store/index.ts');
    const now = Date.now();
    const items = Array.from({ length: count }, (_, index) => ({
      id: `event-${ts}-${index}`,
      household_id: 'playwright-household',
      title: `Event ${index + 1}`,
      start_at: now + index * 60_000,
      end_at: now + index * 60_000 + 30_000,
      start_at_utc: now + index * 60_000,
      end_at_utc: now + index * 60_000 + 30_000,
      created_at: now,
      updated_at: now,
    }));
    actions.events.updateSnapshot({
      items,
      ts,
      window: { start: now - 86_400_000, end: now + 86_400_000 },
      source: 'playwright-truncation-test',
      truncated,
    });
  }, options);
}

test.describe('Truncation banner', () => {
  test('calendar only shows banner when results are truncated', async ({ page }) => {
    await page.goto('/#/calendar');
    await page.waitForSelector('.calendar');

    const banner = page.locator('[data-ui="truncation-banner"]');
    await expect(banner).toBeHidden();

    const baselineTs = Date.now();
    await updateCalendarSnapshot(page, {
      count: 200,
      truncated: false,
      ts: baselineTs,
    });
    await expect(banner).toBeHidden();

    const truncatedTs = baselineTs + 1_000;
    await updateCalendarSnapshot(page, {
      count: 600,
      truncated: true,
      ts: truncatedTs,
    });

    await expect(banner).toBeVisible();
    const formatted = await page.evaluate((value) => value.toLocaleString(), 600);
    await expect(banner).toContainText(`first ${formatted} results`);

    const screenshotPath = test.info().outputPath('truncation-banner.png');
    await page.screenshot({ path: screenshotPath });
    const artifactDir = join(process.cwd(), 'test-results');
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.copyFile(screenshotPath, join(artifactDir, 'truncation-banner.png'));

    await banner.locator('button').click();
    await expect(banner).toBeHidden();

    await updateCalendarSnapshot(page, {
      count: 600,
      truncated: true,
      ts: truncatedTs,
    });
    await expect(banner).toBeHidden();

    await updateCalendarSnapshot(page, {
      count: 600,
      truncated: true,
      ts: truncatedTs + 1,
    });
    await expect(banner).toBeVisible();
  });
});

import { expect, test } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import { createUtcEvents, seedCalendarSnapshot } from '../support/calendar';

test.describe('Truncation banner', () => {
  test('calendar only shows banner when results are truncated', async ({ page }) => {
    await page.goto('/#/calendar');
    await page.waitForSelector('.calendar');

    const banner = page.locator('[data-ui="truncation-banner"]');
    await expect(banner).toBeHidden();

    const baseNow = Date.UTC(2024, 4, 15, 15, 0, 0);
    const calendarWindow = {
      start: baseNow - 86_400_000,
      end: baseNow + 86_400_000,
    };

    const baselineSnapshot = {
      ts: baseNow - 1_000,
      truncated: false,
      events: createUtcEvents({
        baseTs: baseNow,
        count: 200,
        idSeed: 'baseline-utc',
      }),
    } as const;

    await seedCalendarSnapshot(page, {
      events: baselineSnapshot.events,
      truncated: baselineSnapshot.truncated,
      ts: baselineSnapshot.ts,
      window: calendarWindow,
      source: 'playwright-truncation-test',
    });
    await expect(banner).toBeHidden();

    const truncatedSnapshot = {
      ts: baseNow + 1_000,
      truncated: true,
      events: createUtcEvents({
        baseTs: baseNow,
        count: 600,
        idSeed: 'truncated-utc',
      }),
    } as const;

    await seedCalendarSnapshot(page, {
      events: truncatedSnapshot.events,
      truncated: truncatedSnapshot.truncated,
      ts: truncatedSnapshot.ts,
      window: calendarWindow,
      source: 'playwright-truncation-test',
    });

    await expect(banner).toBeVisible();
    const formattedCount = await page.evaluate(
      (count) => new Intl.NumberFormat().format(count),
      truncatedSnapshot.events.length,
    );
    await expect(banner).toContainText(`first ${formattedCount} results`);

    const screenshotPath = test.info().outputPath('truncation-banner.png');
    await page.screenshot({ path: screenshotPath });
    const artifactDir = join(process.cwd(), 'test-results');
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.copyFile(screenshotPath, join(artifactDir, 'truncation-banner.png'));

    await banner.locator('button').click();
    await expect(banner).toBeHidden();

    await seedCalendarSnapshot(page, {
      events: truncatedSnapshot.events,
      truncated: truncatedSnapshot.truncated,
      ts: truncatedSnapshot.ts,
      window: calendarWindow,
      source: 'playwright-truncation-test',
    });
    await expect(banner).toBeHidden();

    const refreshedSnapshot = {
      ts: truncatedSnapshot.ts + 1,
      truncated: true,
      events: createUtcEvents({
        baseTs: baseNow,
        count: 600,
        idSeed: 'truncated-utc-next',
      }),
    } as const;

    await seedCalendarSnapshot(page, {
      events: refreshedSnapshot.events,
      truncated: refreshedSnapshot.truncated,
      ts: refreshedSnapshot.ts,
      window: calendarWindow,
      source: 'playwright-truncation-test',
    });
    await expect(banner).toBeVisible();
  });
});

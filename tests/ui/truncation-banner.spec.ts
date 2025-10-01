import { expect, test, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import { createUtcEvents, seedCalendarSnapshot } from '../support/calendar';

const formatNumber = async (page: Page, value: number) =>
  page.evaluate((count) => new Intl.NumberFormat().format(count), value);

test.describe('Truncation banner', () => {
  test('calendar announces cap, focuses filters, and respects dismissal tokens', async ({ page }) => {
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
        count: 750,
        idSeed: 'truncated-utc',
      }),
      limit: 750,
    } as const;

    await seedCalendarSnapshot(page, {
      events: truncatedSnapshot.events,
      truncated: truncatedSnapshot.truncated,
      ts: truncatedSnapshot.ts,
      window: calendarWindow,
      source: 'playwright-truncation-test',
      limit: truncatedSnapshot.limit,
    });

    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('data-testid', /limit=750/);
    const formattedLimit = await formatNumber(page, truncatedSnapshot.limit);
    await expect(banner).toContainText(`first ${formattedLimit} events`);

    const refineButton = banner.getByRole('button', { name: 'Refine filters' });
    await refineButton.click();
    await expect(page.locator('#calendar-filter')).toBeFocused();

    const screenshotPath = test.info().outputPath('truncation-banner.png');
    await page.screenshot({ path: screenshotPath });
    const artifactDir = join(process.cwd(), 'test-results');
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.copyFile(screenshotPath, join(artifactDir, 'truncation-banner.png'));

    await banner.getByRole('button', { name: /dismiss/i }).click();
    await expect(banner).toBeHidden();

    await seedCalendarSnapshot(page, {
      events: truncatedSnapshot.events,
      truncated: truncatedSnapshot.truncated,
      ts: truncatedSnapshot.ts,
      window: calendarWindow,
      source: 'playwright-truncation-test',
      limit: truncatedSnapshot.limit,
    });
    await expect(banner).toBeHidden();

    const refreshedSnapshot = {
      ts: truncatedSnapshot.ts + 1,
      truncated: true,
      events: createUtcEvents({
        baseTs: baseNow,
        count: 750,
        idSeed: 'truncated-utc-next',
      }),
      limit: truncatedSnapshot.limit,
    } as const;

    await seedCalendarSnapshot(page, {
      events: refreshedSnapshot.events,
      truncated: refreshedSnapshot.truncated,
      ts: refreshedSnapshot.ts,
      window: calendarWindow,
      source: 'playwright-truncation-test',
      limit: refreshedSnapshot.limit,
    });
    await expect(banner).toBeVisible();
  });

  test('hides automatically when filters cut results below the cap', async ({ page }) => {
    await page.goto('/#/calendar');
    await page.waitForSelector('.calendar');

    const baseNow = Date.UTC(2024, 4, 15, 12, 0, 0);
    const calendarWindow = {
      start: baseNow - 86_400_000,
      end: baseNow + 86_400_000,
    };

    await seedCalendarSnapshot(page, {
      events: createUtcEvents({
        baseTs: baseNow,
        count: 30,
        idSeed: 'filter-cap',
      }),
      truncated: true,
      ts: baseNow + 2_000,
      window: calendarWindow,
      source: 'playwright-truncation-test',
      limit: 30,
    });

    const banner = page.locator('[data-ui="truncation-banner"]');
    await expect(banner).toBeVisible();

    const formattedLimit = await formatNumber(page, 30);
    await expect(banner).toContainText(`first ${formattedLimit} events`);

    await page.fill('#calendar-filter', 'does-not-match');
    await page.waitForTimeout(250);
    await expect(banner).toBeHidden();

    await page.fill('#calendar-filter', '');
    await page.waitForTimeout(250);
    await expect(banner).toBeVisible();
  });

  test('pluralises copy based on the limit', async ({ page }) => {
    await page.goto('/#/calendar');
    await page.waitForSelector('.calendar');

    const baseNow = Date.UTC(2024, 6, 1, 12, 0, 0);
    const calendarWindow = {
      start: baseNow - 86_400_000,
      end: baseNow + 86_400_000,
    };

    await seedCalendarSnapshot(page, {
      events: createUtcEvents({
        baseTs: baseNow,
        count: 1,
        idSeed: 'singular-limit',
      }),
      truncated: true,
      ts: baseNow + 5_000,
      window: calendarWindow,
      source: 'playwright-truncation-test',
      limit: 1,
    });

    const banner = page.locator('[data-ui="truncation-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('data-testid', /limit=1$/);
    await expect(banner).toContainText('Only showing the first 1 event');
  });

  test('escape returns focus to refine trigger after focusing filters', async ({ page }) => {
    await page.goto('/#/calendar');
    await page.waitForSelector('.calendar');

    const baseNow = Date.UTC(2024, 5, 15, 10, 0, 0);
    const calendarWindow = {
      start: baseNow - 86_400_000,
      end: baseNow + 86_400_000,
    };

    await seedCalendarSnapshot(page, {
      events: createUtcEvents({
        baseTs: baseNow,
        count: 120,
        idSeed: 'escape-focus',
      }),
      truncated: true,
      ts: baseNow + 3_000,
      window: calendarWindow,
      source: 'playwright-truncation-test',
      limit: 120,
    });

    const banner = page.locator('[data-ui="truncation-banner"]');
    await expect(banner).toBeVisible();
    const refineButton = banner.getByRole('button', { name: 'Refine filters' });
    await refineButton.click();
    const filterInput = page.locator('#calendar-filter');
    await expect(filterInput).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(refineButton).toBeFocused();
  });

  test('slash shortcut ignores active overlays', async ({ page }) => {
    await page.goto('/#/calendar');
    await page.waitForSelector('.calendar');

    await page.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.dataset.ui = 'modal';
      overlay.setAttribute('aria-modal', 'true');
      overlay.id = 'playwright-modal-overlay';
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      const input = document.createElement('input');
      input.type = 'text';
      input.id = 'modal-input';
      dialog.appendChild(input);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      input.focus();
    });

    await page.keyboard.press('/');
    await expect(page.locator('#calendar-filter')).not.toBeFocused();

    await page.evaluate(() => {
      document.getElementById('playwright-modal-overlay')?.remove();
    });

    await page.keyboard.press('/');
    await expect(page.locator('#calendar-filter')).toBeFocused();
  });
});

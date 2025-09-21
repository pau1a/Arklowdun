import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { formatViolations } from './helpers';
import { createUtcEvents, seedCalendarSnapshot } from '../support/calendar';

test.describe('Truncation banner accessibility', () => {
  test('banner announces via status region and passes axe-core scan', async ({ page }) => {
    await page.goto('/#/calendar');
    await page.waitForSelector('main[role="main"]');

    const baseNow = Date.UTC(2024, 4, 16, 9, 30, 0);
    const calendarWindow = {
      start: baseNow - 86_400_000,
      end: baseNow + 86_400_000,
    };
    const truncatedSnapshot = {
      ts: baseNow + 5_000,
      truncated: true,
      events: createUtcEvents({
        baseTs: baseNow,
        count: 600,
        idSeed: 'a11y-truncated-utc',
      }),
    } as const;

    await seedCalendarSnapshot(page, {
      events: truncatedSnapshot.events,
      truncated: truncatedSnapshot.truncated,
      ts: truncatedSnapshot.ts,
      window: calendarWindow,
      source: 'playwright-truncation-a11y',
    });

    const banner = page.locator('[data-ui="truncation-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('role', 'status');
    await expect(banner).toHaveAttribute('aria-live', 'polite');

    const results = await new AxeBuilder({ page })
      .exclude('.sidebar a.active > span')
      .include('[data-ui="truncation-banner"]')
      .withTags(['wcag2a', 'wcag21a', 'wcag2aa', 'wcag21aa'])
      .analyze();

    expect(results.violations, formatViolations(results.violations)).toEqual([]);
  });
});

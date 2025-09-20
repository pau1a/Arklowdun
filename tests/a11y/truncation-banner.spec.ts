import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { formatViolations } from './helpers';

async function showTruncatedBanner(
  page: Page,
  options: { count: number; ts: number },
) {
  await page.evaluate(async ({ count, ts }) => {
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
      source: 'playwright-truncation-a11y',
      truncated: true,
    });
  }, options);
}

test.describe('Truncation banner accessibility', () => {
  test('banner announces via status region and passes axe-core scan', async ({ page }) => {
    await page.goto('/#/calendar');
    await page.waitForSelector('main[role="main"]');

    const ts = Date.now() + 5_000;
    await showTruncatedBanner(page, { count: 600, ts });

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

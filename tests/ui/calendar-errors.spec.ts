import { expect, test } from '@playwright/test';

test.describe('Calendar error surfaces', () => {
  test('shows taxonomy message for unsupported RRULE', async ({ page }) => {
    await page.goto('/#/calendar');

    await page.evaluate(async () => {
      const { emit } = await import('/src/store/events.ts');
      const { describeTimekeepingError } = await import('/src/utils/timekeepingErrors.ts');
      const descriptor = describeTimekeepingError({
        code: 'E_RRULE_UNSUPPORTED_FIELD',
        message: 'failed to parse rrule',
        context: { rule: 'FREQ=DAILY;FOO=BAR' },
      });
      emit('calendar:load-error', {
        message: descriptor.message,
        detail: descriptor.detail ?? undefined,
      });
    });

    const banner = page.locator('.calendar__error-region [data-ui="error-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('This repeat pattern is not yet supported.');
  });
});

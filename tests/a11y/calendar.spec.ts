import { test } from '@playwright/test';
import { expectNoAxeViolations } from './helpers';

test.describe('axe smoke', () => {
  test('calendar view has no accessibility violations', async ({ page }) => {
    await expectNoAxeViolations(page, '/#/calendar');
  });
});

import { test } from '@playwright/test';
import { expectNoAxeViolations } from './helpers';

test.describe('axe smoke', () => {
  test('files view has no accessibility violations', async ({ page }) => {
    await expectNoAxeViolations(page, '/#/files');
  });
});

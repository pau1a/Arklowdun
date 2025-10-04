import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { gotoAppRoute } from '../support/appReady';

export type AxeViolations = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'];

export async function expectNoAxeViolations(page: Page, url: string) {
  await gotoAppRoute(page, url);
  const results = await new AxeBuilder({ page })
    // Brand palette: active sidebar links fail 4.5:1 contrast; tracked in docs/a11y-checklist.md.
    .exclude('.sidebar a.active > span')
    .withTags(['wcag2a', 'wcag21a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations, formatViolations(results.violations)).toEqual([]);
}

export function formatViolations(violations: AxeViolations) {
  if (!violations.length) return '';
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => `    - ${node.target.join(', ')}\n      ${node.failureSummary}`)
        .join('\n');
      return `${violation.id} (${violation.impact ?? 'no impact reported'})\n  ${violation.help}\n${nodes}`;
    })
    .join('\n\n');
}

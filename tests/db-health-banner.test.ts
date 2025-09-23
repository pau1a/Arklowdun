import { strict as assert } from 'node:assert';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import createDbHealthBanner from '../src/ui/DbHealthBanner.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
(globalThis as any).window = dom.window as unknown as typeof globalThis & Window;
(globalThis as any).document = dom.window.document;
(globalThis as any).HTMLElement = dom.window.HTMLElement;

function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('DbHealthBanner updates spinner and messages', async () => {
  const banner = createDbHealthBanner({
    state: 'running',
    hidden: false,
    showSpinner: true,
  });

  assert.equal(banner.dataset.ui, 'db-health-banner');
  assert.equal(banner.dataset.state, 'running');
  assert.equal(banner.hidden, false);
  assert.equal(banner.getAttribute('aria-busy'), 'true');

  const spinner = banner.querySelector('.db-health-banner__spinner');
  if (!spinner) throw new Error('missing spinner element');
  assert.equal(spinner.hasAttribute('hidden'), false);

  banner.update({
    state: 'unhealthy',
    showSpinner: false,
    description: 'Generated recently',
    message: 'Database health issues detected.',
  });

  assert.equal(banner.dataset.state, 'unhealthy');
  assert.equal(banner.getAttribute('aria-busy'), 'false');
  assert.equal(spinner.hasAttribute('hidden'), true);

  const description = banner.querySelector('.db-health-banner__description');
  if (!description) throw new Error('missing description element');
  assert.equal(description.textContent, 'Generated recently');

  banner.update({ hidden: true });
  await nextTick();
  assert.equal(banner.hidden, true);
});

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import createTruncationBanner from '../src/ui/TruncationBanner.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
(globalThis as any).window = dom.window as unknown as typeof globalThis & Window;
(globalThis as any).document = dom.window.document;
(globalThis as any).HTMLElement = dom.window.HTMLElement;

function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('TruncationBanner renders message and toggles visibility', async () => {
  const banner = createTruncationBanner({ count: 500, hidden: true });

  assert.equal(banner.dataset.ui, 'truncation-banner');
  assert.equal(banner.getAttribute('role'), 'status');
  assert.equal(banner.getAttribute('aria-live'), 'polite');
  assert.equal(banner.hidden, true);

  const message = banner.querySelector('.truncation-banner__message');
  if (!message) throw new Error('missing message region');
  const formatted = (500).toLocaleString();
  assert.equal(
    message.textContent,
    `This list was shortened to the first ${formatted} results.`,
  );

  banner.update({ count: 10_000, hidden: false });
  assert.equal(banner.hidden, false);
  const updated = (10_000).toLocaleString();
  assert.equal(
    message.textContent,
    `This list was shortened to the first ${updated} results.`,
  );

  await nextTick();
});

test('TruncationBanner calls onDismiss when Close is pressed', async () => {
  let dismissed = 0;
  const banner = createTruncationBanner({
    count: 600,
    onDismiss: () => {
      dismissed += 1;
      banner.update({ hidden: true });
    },
  });

  const closeButton = banner.querySelector('button');
  if (!closeButton) throw new Error('missing close button');
  assert.equal(banner.hidden, false);

  closeButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await nextTick();

  assert.equal(dismissed, 1);
  assert.equal(banner.hidden, true);
});

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import createTimezoneBadge from '@ui/TimezoneBadge';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
const { window } = dom;
(globalThis as any).window = window as unknown as Window & typeof globalThis;
(globalThis as any).document = window.document;
(globalThis as any).HTMLElement = window.HTMLElement;

if (!('navigator' in globalThis)) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    enumerable: true,
    get: () => window.navigator as Navigator,
  });
}

test.beforeEach(() => {
  window.document.body.innerHTML = '';
});

test('timezone badge renders when timezones differ', () => {
  const badge = createTimezoneBadge({
    eventTimezone: 'America/New_York',
    appTimezone: 'Europe/London',
  });

  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, 'America/New_York');
  assert.equal(badge.tabIndex, 0);
  assert.equal(
    badge.getAttribute('aria-label'),
    'This event is set in America/New_York. Current app timezone is Europe/London.',
  );
});

test('timezone badge hides when timezones match', () => {
  const badge = createTimezoneBadge({
    eventTimezone: 'Europe/London',
    appTimezone: 'europe/london',
  });

  assert.equal(badge.hidden, true);
  assert.equal(badge.tabIndex, -1);
  assert.equal(badge.textContent, '');
  assert.equal(badge.getAttribute('aria-label'), null);
});

test('timezone badge update toggles visibility', () => {
  const badge = createTimezoneBadge({
    eventTimezone: 'Europe/London',
    appTimezone: 'Europe/London',
  });

  assert.equal(badge.hidden, true);

  badge.update({ eventTimezone: 'America/Chicago' });

  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, 'America/Chicago');
  assert.equal(
    badge.getAttribute('aria-label'),
    'This event is set in America/Chicago. Current app timezone is Europe/London.',
  );
});

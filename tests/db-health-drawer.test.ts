import { strict as assert } from 'node:assert';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import createDbHealthDrawer from '../src/ui/DbHealthDrawer.ts';
import type { DbHealthReport } from '../src/bindings/DbHealthReport.ts';
import { __resetKeyboardMapForTests } from '../src/ui/keys.ts';

const dom = new JSDOM('<!doctype html><html><body><div id="modal-root"></div></body></html>');
const domWindow = dom.window;
const { navigator: windowNavigator } = domWindow;
(globalThis as any).window = domWindow as unknown as typeof globalThis & Window;
(globalThis as any).document = domWindow.document;
(globalThis as any).HTMLElement = domWindow.HTMLElement;
(globalThis as any).KeyboardEvent = domWindow.KeyboardEvent;

if (!('navigator' in globalThis)) {
  Object.defineProperty(globalThis, 'navigator', {
    get: () => windowNavigator as Navigator,
    configurable: true,
  });
} else {
  const targetNavigator = globalThis.navigator as Navigator & Record<string, unknown>;
  const sourceNavigator = windowNavigator as Navigator & Record<string, unknown>;
  const keysToCopy = ['platform', 'language', 'languages', 'userAgent'] as const;

  for (const key of keysToCopy) {
    const value = sourceNavigator[key];
    if (value === undefined) continue;
    if (key in targetNavigator && targetNavigator[key] === value) continue;

    try {
      Object.defineProperty(targetNavigator, key, {
        configurable: true,
        enumerable: true,
        value,
      });
      continue;
    } catch {
      try {
        Object.defineProperty(targetNavigator, key, {
          configurable: true,
          enumerable: true,
          get: () => sourceNavigator[key],
        });
      } catch {
        // Ignore failures when navigator properties are locked down.
      }
    }
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test.beforeEach(() => {
  __resetKeyboardMapForTests();
  dom.window.document.body.innerHTML = '<div id="modal-root"></div>';
});

test('DbHealthDrawer renders report details and spinner state', async () => {
  const generatedAt = new Date('2024-05-01T12:00:00Z').toISOString();
  const report: DbHealthReport = {
    status: 'error',
    checks: [
      { name: 'quick_check', passed: true, duration_ms: 8 },
      {
        name: 'foreign_key_check',
        passed: false,
        duration_ms: 4,
        details: '1 foreign key violation(s)',
      },
    ],
    offenders: [
      { table: 'events', rowid: 42, message: 'missing household id' },
    ],
    schema_hash: 'abc123',
    app_version: '0.1.0',
    generated_at: generatedAt,
  };

  let recheckCalls = 0;
  const drawer = createDbHealthDrawer({
    open: false,
    phase: 'idle',
    report: null,
    error: null,
    lastUpdated: null,
    onRecheck: async () => {
      recheckCalls += 1;
    },
  });

  const recheckButton = drawer.dialog.querySelector(
    '.db-health-drawer__recheck',
  ) as HTMLButtonElement | null;
  assert.ok(recheckButton, 're-check button should render');
  assert.equal(recheckButton?.textContent, 'Run health check');
  assert.equal(recheckButton?.disabled, false);

  recheckButton?.click();
  await flush();
  assert.equal(recheckCalls, 1, 're-check handler should run');

  drawer.update({ report, phase: 'idle', lastUpdated: Date.now() });
  await flush();
  assert.equal(recheckButton?.textContent, 'Re-run health check');
  assert.equal(recheckButton?.disabled, false);

  drawer.setOpen(true);
  await flush();

  const badge = drawer.dialog.querySelector('.db-health-drawer__badge');
  assert.ok(badge, 'badge should render');
  assert.equal(badge?.textContent, 'Needs attention');

  const checks = Array.from(
    drawer.dialog.querySelectorAll('.db-health-drawer__check'),
  );
  assert.equal(checks.length, 2);
  const failingCheck = checks.find((item) =>
    item.textContent?.includes('Foreign Key Check'),
  );
  assert.ok(failingCheck, 'foreign key check should be present');
  assert.match(failingCheck?.textContent ?? '', /Failed/);

  const offenderMessage = drawer.dialog.querySelector(
    '.db-health-drawer__offender-message',
  );
  assert.equal(offenderMessage?.textContent, 'missing household id');

  const metadata = drawer.dialog.querySelector('.db-health-drawer__metadata');
  assert.ok(metadata, 'metadata list should render');
  assert.match(metadata?.textContent ?? '', /Schema hash/);

  drawer.update({ phase: 'pending' });
  await flush();

  const spinner = drawer.dialog.querySelector('.db-health-drawer__spinner');
  assert.ok(spinner, 'spinner should render in pending state');
  assert.equal(spinner?.hasAttribute('hidden'), false);

  assert.equal(recheckButton?.disabled, true, 're-check disabled while pending');
  assert.equal(recheckButton?.textContent, 'Re-checking…');

  recheckButton?.click();
  await flush();
  assert.equal(
    recheckCalls,
    1,
    'clicks during pending state should not trigger handler again',
  );

  drawer.update({ phase: 'idle' });
  await flush();
  assert.equal(recheckButton?.disabled, false);

  drawer.setOpen(false);
  await flush();
  assert.equal(drawer.isOpen(), false);
});

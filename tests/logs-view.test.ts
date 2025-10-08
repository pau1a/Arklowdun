import { strict as assert } from 'node:assert';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { mountLogsView } from '../src/ui/views/logsView.ts';
import {
  logsStore,
  __setTailFetcherForTests,
  __resetTailFetcherForTests,
} from '../src/features/logs/logs.store.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost',
});

(globalThis as any).window = dom.window as unknown as typeof globalThis & Window;
(globalThis as any).document = dom.window.document;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
(globalThis as any).HTMLSelectElement = dom.window.HTMLSelectElement;
(globalThis as any).HTMLTableSectionElement = dom.window.HTMLTableSectionElement;

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('LogsView renders table, summary, and banners', async () => {
  logsStore.clear();
  __setTailFetcherForTests(async () => ({
    lines: [
      {
        ts: '2025-10-07T18:24:00Z',
        level: 'error',
        event: 'gamma',
        message: 'Gamma failure',
      },
      {
        ts: '2025-10-07T18:23:00Z',
        level: 'warn',
        event: 'beta',
        message: 'Beta warning',
      },
      {
        ts: '2025-10-07T18:22:00Z',
        level: 'info',
        event: 'alpha',
        message: 'Alpha info',
      },
    ],
    dropped_count: 3,
    log_write_status: 'io_error',
  }));

  const container = document.createElement('div');
  document.body.appendChild(container);

  const cleanup = mountLogsView(container);
  await flush();

  const loading = container.querySelector<HTMLElement>("[data-testid='logs-loading']");
  const summary = container.querySelector<HTMLElement>('.logs-summary');
  const backlogBanner = container.querySelector<HTMLElement>("[data-banner='backlog']");
  const ioBanner = container.querySelector<HTMLElement>("[data-banner='io']");
  const rows = container.querySelectorAll<HTMLTableRowElement>('.logs-table tbody tr');
  const categories = container.querySelectorAll<HTMLInputElement>(
    '.logs-filter__menu input[type="checkbox"]',
  );

  assert.ok(loading);
  assert.equal(loading?.hidden, true);
  assert.ok(summary);
  assert.match(summary?.textContent ?? '', /Showing 3 log lines/);
  assert.ok(backlogBanner);
  assert.equal(backlogBanner?.hidden, false);
  assert.ok(ioBanner);
  assert.equal(ioBanner?.hidden, false);
  assert.equal(categories.length, 3);
  assert.equal(rows.length, 3);
  assert.equal(
    rows[0]?.querySelector<HTMLElement>('.logs-table__cell--event')?.textContent,
    'gamma',
  );

  cleanup();
  container.remove();
  __resetTailFetcherForTests();
  logsStore.clear();
});

test('LogsView supports severity and search filtering', async () => {
  logsStore.clear();
  __setTailFetcherForTests(async () => ({
    lines: [
      { ts: '2025-10-07T18:30:00Z', level: 'debug', event: 'delta', message: 'Debug noise' },
      { ts: '2025-10-07T18:31:00Z', level: 'warn', event: 'epsilon', message: 'Warn threshold' },
      { ts: '2025-10-07T18:32:00Z', level: 'error', event: 'zeta', message: 'Critical failure' },
    ],
  }));

  const container = document.createElement('div');
  document.body.appendChild(container);

  const cleanup = mountLogsView(container);
  await flush();

  const severity = container.querySelector<HTMLSelectElement>("[data-testid='logs-filter-severity']");
  const search = container.querySelector<HTMLInputElement>("[data-testid='logs-filter-search']");
  assert.ok(severity);
  assert.ok(search);

  severity!.value = 'warn';
  severity!.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

  let rows = Array.from(container.querySelectorAll<HTMLTableRowElement>('.logs-table tbody tr'));
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.querySelector<HTMLElement>('.logs-table__cell--event')?.textContent),
    ['zeta', 'epsilon'],
  );

  search!.value = 'critical';
  search!.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

  rows = Array.from(container.querySelectorAll<HTMLTableRowElement>('.logs-table tbody tr'));
  assert.equal(rows.length, 1);
  assert.equal(
    rows[0]?.querySelector<HTMLElement>('.logs-table__cell--event')?.textContent,
    'zeta',
  );

  cleanup();
  container.remove();
  __resetTailFetcherForTests();
  logsStore.clear();
});

test('LogsView toggles timezone display', async () => {
  logsStore.clear();
  const ts = '2025-10-07T18:00:00Z';
  __setTailFetcherForTests(async () => ({
    lines: [
      { ts, level: 'info', event: 'alpha', message: 'Alpha info' },
    ],
  }));

  const container = document.createElement('div');
  document.body.appendChild(container);

  const cleanup = mountLogsView(container);
  await flush();

  let timestampCell = container.querySelector<HTMLElement>('.logs-table__cell--timestamp');
  assert.ok(timestampCell);
  const expectedLocal = new Date(ts).toLocaleString('en-GB', { timeZone: 'Europe/London' });
  assert.equal(timestampCell?.textContent, expectedLocal);

  const utcButton = container.querySelector<HTMLButtonElement>(".logs-time-toggle__button[data-timezone='utc']");
  assert.ok(utcButton);
  utcButton!.click();

  timestampCell = container.querySelector<HTMLElement>('.logs-table__cell--timestamp');
  assert.equal(timestampCell?.textContent, ts);

  cleanup();
  container.remove();
  __resetTailFetcherForTests();
  logsStore.clear();
});

test('LogsView surfaces IPC errors', async () => {
  logsStore.clear();
  __setTailFetcherForTests(async () => {
    throw new Error('IPC offline');
  });

  const container = document.createElement('div');
  document.body.appendChild(container);

  const cleanup = mountLogsView(container);
  await flush();

  const error = container.querySelector<HTMLElement>("[data-testid='logs-error']");
  assert.ok(error);
  assert.equal(error?.hidden, false);
  assert.equal(error?.textContent, 'IPC offline');

  cleanup();
  container.remove();
  __resetTailFetcherForTests();
  logsStore.clear();
});

test('LogsView enables export button when data is ready', async () => {
  logsStore.clear();
  __setTailFetcherForTests(async () => ({
    lines: [
      { ts: '2025-10-07T18:30:00Z', level: 'info', event: 'alpha', message: 'ready' },
    ],
  }));

  const container = document.createElement('div');
  document.body.appendChild(container);

  const cleanup = mountLogsView(container);

  const exportButton = container.querySelector<HTMLButtonElement>("[data-testid='logs-export']");
  assert.ok(exportButton);
  assert.equal(exportButton?.disabled, true);

  await flush();

  assert.equal(exportButton?.disabled, false);

  cleanup();
  container.remove();
  __resetTailFetcherForTests();
  logsStore.clear();
});

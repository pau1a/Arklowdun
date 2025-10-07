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

test('LogsView fetches diagnostics tail on mount and shows ready state', async () => {
  logsStore.clear();
  __setTailFetcherForTests(async () => [
    {
      ts: '2025-10-07T18:22:00Z',
      level: 'info',
      event: 'alpha',
    },
    {
      ts: '2025-10-07T18:23:00Z',
      level: 'warn',
      event: 'beta',
    },
  ]);

  const container = document.createElement('div');
  document.body.appendChild(container);

  const cleanup = mountLogsView(container);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const loading = container.querySelector<HTMLElement>(
    "[data-testid='logs-loading']",
  );
  const ready = container.querySelector<HTMLElement>(
    "[data-testid='logs-ready']",
  );
  const empty = container.querySelector<HTMLElement>(
    "[data-testid='logs-empty']",
  );

  assert.ok(loading);
  assert.ok(ready);
  assert.ok(empty);
  assert.equal(loading?.hidden, true);
  assert.equal(ready?.hidden, false);
  assert.equal(empty?.hidden, true);

  const summary = ready?.querySelector('.logs-ready__summary');
  assert.ok(summary);
  assert.match(summary?.textContent ?? '', /Showing 2 log lines/);

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
  await new Promise((resolve) => setTimeout(resolve, 0));

  const loading = container.querySelector<HTMLElement>(
    "[data-testid='logs-loading']",
  );
  const error = container.querySelector<HTMLElement>(
    "[data-testid='logs-error']",
  );
  const message = error?.querySelector('.logs-error__message');

  assert.ok(loading);
  assert.ok(error);
  assert.equal(loading?.hidden, true);
  assert.equal(error?.hidden, false);
  assert.equal(message?.textContent, 'IPC offline');

  cleanup();
  container.remove();
  __resetTailFetcherForTests();
  logsStore.clear();
});

test('LogsView shows empty state when no lines parsed', async () => {
  logsStore.clear();
  __setTailFetcherForTests(async () => []);

  const container = document.createElement('div');
  document.body.appendChild(container);

  const cleanup = mountLogsView(container);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const empty = container.querySelector<HTMLElement>(
    "[data-testid='logs-empty']",
  );
  const ready = container.querySelector<HTMLElement>(
    "[data-testid='logs-ready']",
  );

  assert.ok(empty);
  assert.ok(ready);
  assert.equal(empty?.hidden, false);
  assert.equal(ready?.hidden, true);

  cleanup();
  container.remove();
  __resetTailFetcherForTests();
  logsStore.clear();
});

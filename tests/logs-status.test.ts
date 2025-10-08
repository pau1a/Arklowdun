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

dom.window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
  dom.window.setTimeout(() => callback(performance.now()), 0)) as typeof dom.window.requestAnimationFrame;

(globalThis as any).window = dom.window as unknown as typeof globalThis & Window;
(globalThis as any).document = dom.window.document;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
(globalThis as any).HTMLSelectElement = dom.window.HTMLSelectElement;
(globalThis as any).HTMLTableSectionElement = dom.window.HTMLTableSectionElement;

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('Logs status banner reflects dropped entries and IO errors', async () => {
  logsStore.clear();

  const responses = [
    {
      lines: [
        { ts: '2025-10-07T18:24:00Z', level: 'info', event: 'alpha', message: 'Alpha info' },
      ],
      dropped_count: 2,
      log_write_status: 'ok',
    },
    {
      lines: [
        { ts: '2025-10-07T18:25:00Z', level: 'warn', event: 'beta', message: 'Beta warn' },
      ],
      log_write_status: 'io_error',
    },
    {
      lines: [
        { ts: '2025-10-07T18:26:00Z', level: 'info', event: 'gamma', message: 'Gamma info' },
      ],
      log_write_status: 'ok',
    },
  ];

  __setTailFetcherForTests(async () => {
    return responses.shift() ?? { lines: [] };
  });

  const container = document.createElement('div');
  document.body.appendChild(container);

  try {
    const cleanup = mountLogsView(container);
    await flush();

    const status = container.querySelector<HTMLElement>('#logs-status');
    assert.ok(status);
    assert.equal(
      status?.textContent,
      '⚠ Some log entries may have been skipped (buffer full).',
    );
    assert.equal(status?.hidden, false);

    await logsStore.fetchTail();
    await flush();
    assert.equal(status?.textContent, '⚠ Logging paused – disk write issue detected.');
    assert.equal(status?.hidden, false);

    await logsStore.fetchTail();
    await flush();
    assert.equal(status?.textContent, '');
    assert.equal(status?.hidden, true);

    cleanup();
  } finally {
    container.remove();
    __resetTailFetcherForTests();
    logsStore.clear();
  }
});

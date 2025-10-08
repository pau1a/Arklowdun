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

test('Logs view cleanup clears timers, entries, and subscriptions', async () => {
  logsStore.clear();
  __setTailFetcherForTests(async () => ({
    lines: [
      {
        ts: '2025-10-07T18:24:00Z',
        level: 'info',
        event: 'alpha',
        message: 'Alpha info',
      },
    ],
  }));

  const container = document.createElement('div');
  document.body.appendChild(container);

  const createdIntervals: number[] = [];
  const clearedIntervals: number[] = [];
  let nextIntervalId = 1;
  const originalSetInterval = window.setInterval;
  const originalClearInterval = window.clearInterval;

  window.setInterval = ((callback: TimerHandler, delay?: number) => {
    const id = nextIntervalId++;
    createdIntervals.push(id);
    return id as unknown as number;
  }) as typeof window.setInterval;

  window.clearInterval = ((handle: number | NodeJS.Timeout) => {
    clearedIntervals.push(handle as number);
  }) as typeof window.clearInterval;

  try {
    const cleanup = mountLogsView(container);
    await flush();

    const toggle = container.querySelector<HTMLInputElement>("[data-testid='logs-live-toggle']");
    assert.ok(toggle, 'expected live tail toggle to be present');
    toggle!.checked = true;
    toggle!.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    await flush();

    assert.equal(createdIntervals.length, 1, 'live tail should schedule one interval');

    const tableBody = container.querySelector<HTMLTableSectionElement>('.logs-table tbody');
    assert.ok(tableBody);

    cleanup();

    assert.deepEqual(
      clearedIntervals,
      createdIntervals,
      'cleanup should clear all created intervals',
    );
    assert.equal(createdIntervals.length, clearedIntervals.length);
    assert.equal(logsStore.state.status, 'idle');
    assert.equal(logsStore.state.entries.length, 0);
    assert.equal(tableBody?.children.length, 0);
  } finally {
    window.setInterval = originalSetInterval;
    window.clearInterval = originalClearInterval;
    container.remove();
    __resetTailFetcherForTests();
    logsStore.clear();
  }
});

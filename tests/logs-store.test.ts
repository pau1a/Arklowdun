import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  logsStore,
  selectAll,
  selectCategories,
  selectLevels,
  selectRange,
  __setTailFetcherForTests,
  __resetTailFetcherForTests,
} from '../src/features/logs/logs.store.ts';

const WAIT = () => new Promise((resolve) => setTimeout(resolve, 0));

test('fetchTail parses lines, skips malformed, and exposes selectors', async () => {
  logsStore.clear();
  __setTailFetcherForTests(async () => [
    JSON.stringify({
      ts: '2025-10-07T18:21:00Z',
      level: 'info',
      event: 'alpha',
    }),
    'not-json',
    {
      ts: '2025-10-07T18:22:00Z',
      level: 'warn',
      event: 'beta',
      message: 'warning',
    },
    {
      level: 'error',
      event: 'missing-ts',
    },
  ]);

  await logsStore.fetchTail();
  await WAIT();

  assert.equal(logsStore.state.status, 'ready');
  assert.equal(logsStore.state.entries.length, 2);
  assert.equal(logsStore.state.entries[0].event, 'beta');
  assert.equal(logsStore.state.entries[1].event, 'alpha');

  const snapshot = logsStore.state;
  assert.deepEqual(selectAll(snapshot).map((e) => e.event), ['beta', 'alpha']);
  assert.deepEqual(selectLevels(snapshot), ['warn', 'info']);
  assert.deepEqual(selectCategories(snapshot), ['beta', 'alpha']);
  const range = selectRange(snapshot);
  assert.equal(range.max, snapshot.entries[0].tsEpochMs);
  assert.equal(range.min, snapshot.entries[1].tsEpochMs);

  __resetTailFetcherForTests();
  logsStore.clear();
});

test('fetchTail caps entries at 200 and sorts newest first', async () => {
  logsStore.clear();
  __setTailFetcherForTests(async () => {
    const start = Date.parse('2025-10-07T00:00:00Z');
    const lines: Record<string, unknown>[] = [];
    for (let i = 0; i < 250; i += 1) {
      lines.push({
        ts: new Date(start + i * 1000).toISOString(),
        level: 'info',
        event: 'bulk',
      });
    }
    return lines;
  });

  await logsStore.fetchTail();
  await WAIT();

  assert.equal(logsStore.state.status, 'ready');
  assert.equal(logsStore.state.entries.length, 200);
  const first = logsStore.state.entries[0];
  const last = logsStore.state.entries[logsStore.state.entries.length - 1];
  assert.ok(first.tsEpochMs > last.tsEpochMs);

  const expectedMax = Date.parse('2025-10-07T00:04:09Z');
  const expectedMin = Date.parse('2025-10-07T00:00:50Z');
  assert.equal(first.tsEpochMs, expectedMax);
  assert.equal(last.tsEpochMs, expectedMin);

  __resetTailFetcherForTests();
  logsStore.clear();
});

test('fetchTail records IPC failures as error state', async () => {
  logsStore.clear();
  __setTailFetcherForTests(async () => {
    throw new Error('IPC unavailable');
  });

  await logsStore.fetchTail();
  await WAIT();

  assert.equal(logsStore.state.status, 'error');
  assert.equal(logsStore.state.entries.length, 0);
  assert.equal(logsStore.state.error, 'IPC unavailable');

  __resetTailFetcherForTests();
  logsStore.clear();
});

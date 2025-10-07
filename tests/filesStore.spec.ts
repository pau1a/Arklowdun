import test from 'node:test';
import { strict as assert } from 'node:assert';

import {
  actions,
  selectors,
  getState,
  __resetStore,
} from '../src/store/index.ts';

test.beforeEach(() => {
  __resetStore();
});

test('beginScan and timeout update status timeline', () => {
  actions.files.beginScan();
  assert.equal(selectors.files.scanStatus(getState()), 'scanning');
  const startedAt = selectors.files.scanStartedAt(getState());
  assert.equal(typeof startedAt, 'number');

  actions.files.timeoutScan();
  assert.equal(selectors.files.scanStatus(getState()), 'timeout');
  const duration = selectors.files.scanDuration(getState());
  assert.equal(typeof duration, 'number');
  assert.ok((duration ?? 0) >= 0);

  actions.files.resetScan();
  assert.equal(selectors.files.scanStatus(getState()), 'idle');
  assert.equal(selectors.files.scanDuration(getState()), null);
});

test('updateSnapshot marks scan done and records payload', () => {
  actions.files.beginScan();
  const payload = actions.files.updateSnapshot({
    items: [{ name: 'example.txt' }],
    ts: 123,
    path: '.',
    source: 'test',
  });

  assert.equal(payload.count, 1);
  assert.equal(payload.ts, 123);
  assert.equal(selectors.files.scanStatus(getState()), 'done');
  const duration = selectors.files.scanDuration(getState());
  assert.equal(typeof duration, 'number');
  assert.ok((duration ?? 0) >= 0);
});

test('failScan records error state', () => {
  actions.files.beginScan();
  actions.files.failScan({ message: 'nope' });
  assert.equal(selectors.files.scanStatus(getState()), 'error');
  const error = selectors.files.error(getState());
  assert.ok(error);
  assert.equal(error?.message, 'nope');
});


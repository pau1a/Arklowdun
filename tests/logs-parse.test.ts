import { strict as assert } from 'node:assert';
import test from 'node:test';
import { parseLogLine } from '../src/features/logs/logs.parse.ts';

const TS = '2025-10-07T18:22:10Z';

function epoch(ts: string): number {
  return Date.parse(ts);
}

test('parseLogLine parses valid JSON string into entry', () => {
  const line = JSON.stringify({
    ts: TS,
    level: 'INFO',
    event: 'auth',
    message: 'login ok',
  });

  const entry = parseLogLine(line);
  assert.ok(entry, 'expected entry');
  assert.equal(entry?.tsUtc, TS);
  assert.equal(entry?.tsEpochMs, epoch(TS));
  assert.equal(entry?.level, 'info');
  assert.equal(entry?.event, 'auth');
  assert.equal(entry?.message, 'login ok');
});

test('parseLogLine accepts object payloads', () => {
  const line = {
    ts: TS,
    level: 'warn',
    event: 'fs',
    household_id: 'abc',
  };

  const entry = parseLogLine(line);
  assert.ok(entry, 'expected entry');
  assert.equal(entry?.household_id, 'abc');
  assert.equal(entry?.level, 'warn');
  assert.equal(entry?.event, 'fs');
});

test('parseLogLine returns null for malformed JSON strings', () => {
  const entry = parseLogLine('{"ts":');
  assert.equal(entry, null);
});

test('parseLogLine skips lines without timestamp', () => {
  const entry = parseLogLine({ level: 'info', event: 'auth' });
  assert.equal(entry, null);
});

test('parseLogLine defaults missing event to misc', () => {
  const entry = parseLogLine({ ts: TS, level: 'info' });
  assert.ok(entry);
  assert.equal(entry?.event, 'misc');
});

test('parseLogLine coerces unknown level to info', () => {
  const entry = parseLogLine({ ts: TS, level: 'verbose', event: 'trace' });
  assert.ok(entry);
  assert.equal(entry?.level, 'info');
});

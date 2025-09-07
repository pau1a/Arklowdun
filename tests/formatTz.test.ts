import { strict as assert } from 'node:assert';
import test from 'node:test';

test('formats utc ms in timezone', () => {
  const ms = Date.UTC(2025, 8, 7, 9, 0); // 2025-09-07 09:00 UTC
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  assert.equal(fmt.format(ms), '10:00');
});

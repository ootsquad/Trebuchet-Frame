import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWhen } from '../src/schedule.js';
import { weekIndex, weekStart, formatPlaytime } from '../src/stats.js';

const now = new Date('2026-11-18T15:00:00Z'); // 10:00 in New York
const opts = { now, timeZone: 'America/New_York' };

test('reads full dates in the time zone', () => {
  assert.equal(parseWhen('2026-11-20 19:30', opts).toISOString(), '2026-11-21T00:30:00.000Z');
  assert.equal(parseWhen('11/20 7:30pm', opts).toISOString(), '2026-11-21T00:30:00.000Z');
});
test('reads clock times and relative times', () => {
  assert.equal(parseWhen('19:00', opts).toISOString(), '2026-11-19T00:00:00.000Z');
  assert.equal(parseWhen('9am', opts).toISOString(), '2026-11-19T14:00:00.000Z');
  assert.equal(parseWhen('tomorrow 19:00', opts).toISOString(), '2026-11-20T00:00:00.000Z');
  assert.equal(parseWhen('in 1h30m', opts).toISOString(), '2026-11-18T16:30:00.000Z');
  assert.equal(parseWhen('soon', opts), null);
});
test('summer time is handled', () => {
  assert.equal(parseWhen('2026-07-04 12:00', opts).toISOString(), '2026-07-04T16:00:00.000Z');
});
test('weeks start on Monday UTC like the game', () => {
  const week = weekIndex(now);
  assert.equal(weekStart(week).toISOString(), '2026-11-16T00:00:00.000Z');
  assert.equal(formatPlaytime(3 * 3600 + 5 * 60), '3h 5m');
});

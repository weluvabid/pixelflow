import test from 'node:test';
import assert from 'node:assert/strict';
import { elapsedAt, formatDuration } from '../../../src/lib/chronos/dashboard/timer-format.ts';

test('elapsedAt handles unset timestamps and clamps negative time', () => {
  assert.equal(elapsedAt(Number.NaN, 100), 0);
  assert.equal(elapsedAt(120, 100), 0);
  assert.equal(elapsedAt(100, 250), 150);
});

test('formatDuration formats long-running timers and rejects invalid values', () => {
  assert.equal(formatDuration(0), '00:00:00');
  assert.equal(formatDuration(3_723_000), '01:02:03');
  assert.throws(() => formatDuration(Number.NaN), RangeError);
  assert.throws(() => formatDuration(-1), RangeError);
});

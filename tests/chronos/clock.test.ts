import test from 'node:test';
import assert from 'node:assert/strict';
import { PerformanceClock } from '../../src/lib/chronos/core/clock.ts';

test('performance clock clamps backwards source readings to preserve monotonic time', () => {
  const readings = [100, 99.5, 100.25, 101];
  const clock = new PerformanceClock(() => {
    const reading = readings.shift();

    if (reading === undefined) throw new Error('Unexpected clock read.');

    return reading;
  });

  assert.deepEqual([clock.now(), clock.now(), clock.now(), clock.now()], [100, 100, 100.25, 101]);
});

test('performance clock rejects non-finite source readings', () => {
  const clock = new PerformanceClock(() => Number.NaN);

  assert.throws(() => clock.now(), /non-finite/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { ManualClock } from '../../src/lib/chronos/core/clock.ts';
import { TimerRegistry } from '../../src/lib/chronos/core/timer-registry.ts';
import { ChronosError } from '../../src/lib/chronos/core/types.ts';

test('elapsed duration is derived directly from one start-timestamp array', () => {
  const clock = new ManualClock(100);
  const registry = new TimerRegistry(clock, 2);
  const id = registry.create();
  registry.start(id);
  clock.advance(1_250);
  assert.equal(registry.elapsed(id), 1_250);
  clock.advance(5_000);
  assert.equal(registry.elapsed(id), 6_250);
  assert.equal(registry.activeCount, 1);
});

test('clearing a call removes its timestamp and starting it records a new epoch', () => {
  const clock = new ManualClock(10);
  const registry = new TimerRegistry(clock);
  const id = registry.create();
  registry.start(id);
  clock.advance(100);
  registry.clear(id);
  assert.equal(registry.elapsed(id), 0);
  assert.equal(registry.activeCount, 0);
  clock.advance(50);
  registry.start(id);
  clock.advance(25);
  assert.equal(registry.elapsed(id), 25);
});

test('registry grows geometrically and returns bounded timestamp windows', () => {
  const registry = new TimerRegistry(new ManualClock(), 2);
  const ids = Array.from({ length: 5 }, () => registry.create());
  ids.forEach((id) => registry.start(id));
  assert.equal(registry.capacity, 8);
  assert.equal(registry.size, 5);
  assert.equal(registry.activeCount, 5);
  const page = registry.windowBuffers(2, 2);
  assert.equal(page.total, 5);
  assert.equal(page.startedAt.length, 2);
  assert.deepEqual(Array.from(page.startedAt), [0, 0]);
  assert.throws(() => registry.windowBuffers(-1, 10), RangeError);
  assert.throws(() => registry.windowBuffers(0, 10_001), RangeError);
});

test('invalid identifiers and clock regressions fail without changing timestamps', () => {
  let now = 10;
  const registry = new TimerRegistry({ now: () => now });
  const id = registry.create();
  registry.start(id);
  now = 9;
  assert.throws(
    () => registry.elapsed(id),
    (error: unknown) => error instanceof ChronosError && error.code === 'CLOCK_REGRESSION',
  );
  assert.throws(
    () => registry.start(99),
    (error: unknown) => error instanceof ChronosError && error.code === 'INVALID_TIMER_ID',
  );
});

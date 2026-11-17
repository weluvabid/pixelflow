import test from 'node:test';
import assert from 'node:assert/strict';
import { ManualClock } from '../../src/lib/chronos/core/clock.ts';
import { ChronosEngine } from '../../src/lib/chronos/core/engine.ts';
import { TimerMatrixSimulation } from '../../src/lib/chronos/simulation/timer-matrix.ts';

test('100k timer population starts with deterministic, varied elapsed offsets', () => {
  const clock = new ManualClock(1_000);
  const simulation = new TimerMatrixSimulation(new ChronosEngine(clock), 1234);
  const summary = simulation.initialize(100_000);
  assert.deepEqual(summary, { seed: 1234, timers: 100_000 });
  assert.equal(simulation.engine.timers.activeCount, 100_000);

  const page = simulation.windowBuffers(0, 64);
  const timestamps = Array.from(page.startedAt);
  const elapsedOffsets = timestamps.map((startedAt) => clock.now() - startedAt);
  assert.ok(elapsedOffsets.every((elapsed) => elapsed >= 0 && elapsed <= 5 * 60 * 1_000));
  assert.ok(new Set(timestamps).size > 1, 'initial timestamps should not all be synchronized');

  const replay = new TimerMatrixSimulation(new ChronosEngine(new ManualClock(1_000)), 1234);
  replay.initialize(100_000);
  assert.deepEqual(Array.from(replay.windowBuffers(0, 64).startedAt), timestamps);

  clock.advance(5_000);
  assert.equal(
    clock.now() - (simulation.windowBuffers(42_979, 1).startedAt[0] ?? 0),
    5_000 + (1_000 - (simulation.windowBuffers(42_979, 1).startedAt[0] ?? 0)),
  );
});

test('simulation rejects unsupported sizes', () => {
  const simulation = new TimerMatrixSimulation(new ChronosEngine(new ManualClock()));
  assert.throws(() => simulation.initialize(100_001), RangeError);
});

test('failed initialization resets the timestamp registry', () => {
  const engine = new ChronosEngine({ now: () => Number.NaN });
  const simulation = new TimerMatrixSimulation(engine, 1234);
  assert.throws(() => simulation.initialize(1_000), /Clock returned a non-finite value/);
  assert.equal(engine.timers.size, 0);
  assert.equal(engine.timers.activeCount, 0);
});

test('window query returns only requested timestamps', () => {
  const simulation = new TimerMatrixSimulation(new ChronosEngine(new ManualClock(10)), 1234);
  simulation.initialize(1_000);
  const page = simulation.windowBuffers(500, 24);
  assert.equal(page.offset, 500);
  assert.equal(page.total, 1_000);
  assert.equal(page.startedAt.length, 24);
  assert.throws(() => simulation.windowBuffers(-1, 10), RangeError);
  assert.throws(() => simulation.windowBuffers(0, 10_001), RangeError);
});

test('simulation samples the clock once for the entire initial population', () => {
  let reads = 0;
  const clock = {
    now: () => {
      reads += 1;

      return 10_000;
    },
  };
  const simulation = new TimerMatrixSimulation(new ChronosEngine(clock), 1234);

  simulation.initialize(100_000);

  assert.equal(reads, 1);
});

test('empty simulation does not sample an unused clock', () => {
  const engine = new ChronosEngine({ now: () => Number.NaN });
  const simulation = new TimerMatrixSimulation(engine);

  assert.deepEqual(simulation.initialize(0), { seed: 0x00c0ffee, timers: 0 });
});

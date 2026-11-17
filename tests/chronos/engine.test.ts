import test from 'node:test';
import assert from 'node:assert/strict';
import { ManualClock } from '../../src/lib/chronos/core/clock.ts';
import { ChronosEngine } from '../../src/lib/chronos/core/engine.ts';

test('engine schedules deadlines against numeric timer identifiers', () => {
  const clock = new ManualClock(100);
  const engine = new ChronosEngine(clock);
  const id = engine.createTimer();
  engine.start(id);
  const eventId = engine.scheduleDeadline(id, 500, 42);
  assert.equal(engine.metrics().scheduledEvents, 1);
  assert.equal(engine.metrics().nextDeadline, 500);
  assert.equal(engine.cancelDeadline(eventId), true);
  assert.equal(engine.metrics().scheduledEvents, 0);
});

test('engine drains scheduled events without mutating elapsed time', () => {
  const clock = new ManualClock(10);
  const engine = new ChronosEngine(clock);
  const id = engine.createTimer();
  engine.start(id);
  engine.scheduleDeadline(id, 20);
  clock.advance(15);
  assert.equal(engine.drainDue().length, 1);
  assert.equal(engine.elapsed(id), 15);
});

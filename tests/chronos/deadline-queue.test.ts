import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DeadlineQueue,
  ScheduledEventKind,
} from '../../src/lib/chronos/scheduler/deadline-queue.ts';

test('deadline queue drains in deadline order with stable FIFO ordering for ties', () => {
  const queue = new DeadlineQueue(1);
  const handle = 3;
  const first = queue.schedule(20, ScheduledEventKind.TimerDeadline, handle);
  const second = queue.schedule(10, ScheduledEventKind.TimerDeadline, handle);
  const third = queue.schedule(10, ScheduledEventKind.Custom, handle, 7);

  assert.equal(queue.nextDeadline, 10);
  assert.deepEqual(
    queue.popDue(10).map((event) => event.id),
    [second, third],
  );
  assert.equal(queue.size, 1);
  assert.equal(queue.popDue(19).length, 0);
  assert.deepEqual(
    queue.popDue(20).map((event) => event.id),
    [first],
  );
  assert.equal(queue.nextDeadline, null);
});

test('arbitrary cancellation preserves heap invariants', () => {
  const queue = new DeadlineQueue(2);
  const handle = 0;
  const ids = Array.from({ length: 100 }, (_, i) =>
    queue.schedule(100 - i, ScheduledEventKind.Custom, handle),
  );
  const cancelledId = ids.at(50);

  assert.ok(cancelledId !== undefined);
  assert.equal(queue.cancel(cancelledId), true);
  assert.equal(queue.cancel(cancelledId), false);
  const events = queue.popDue(1_000);

  assert.equal(events.length, 99);
  assert.equal(
    events.some((event) => event.id === ids[50]),
    false,
  );
  assert.deepEqual(
    events.map((event) => event.deadline),
    [...events.map((event) => event.deadline)].sort((a, b) => a - b),
  );
});

test('invalid event payloads and deadlines are rejected', () => {
  const queue = new DeadlineQueue();
  const handle = 0;

  assert.throws(() => queue.schedule(Number.NaN, ScheduledEventKind.Custom, handle), RangeError);
  assert.throws(
    () => queue.schedule(1, 99 as ScheduledEventKind, handle),
    /Unsupported event kind/,
  );
});

test('due-event drain limits preserve overdue events for the next central wakeup', () => {
  const queue = new DeadlineQueue();
  const handle = 2;

  for (let index = 0; index < 5; index += 1) {
    queue.schedule(10, ScheduledEventKind.Custom, handle, index);
  }

  assert.deepEqual(
    queue.popDue(10, 2).map((event) => event.payload),
    [0, 1],
  );
  assert.equal(queue.size, 3);
  assert.deepEqual(
    queue.popDue(10, 10).map((event) => event.payload),
    [2, 3, 4],
  );
});

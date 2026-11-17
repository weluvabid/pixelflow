import type { Clock } from './clock.ts';
import { TimerRegistry } from './timer-registry.ts';
import type { TimerHandle } from './types.ts';
import {
  DeadlineQueue,
  ScheduledEventKind,
  type ScheduledEvent,
} from '../scheduler/deadline-queue.ts';

export interface EngineMetrics {
  readonly timers: number;
  readonly activeTimers: number;
  readonly capacity: number;
  readonly scheduledEvents: number;
  readonly nextDeadline: number | null;
}

export class ChronosEngine {
  readonly timers: TimerRegistry;
  readonly deadlines: DeadlineQueue;
  readonly #clock: Clock;

  constructor(clock: Clock, initialCapacity?: number) {
    this.#clock = clock;
    this.timers = new TimerRegistry(clock, initialCapacity);
    this.deadlines = new DeadlineQueue();
  }

  createTimer(): TimerHandle {
    return this.timers.create();
  }

  start(handle: TimerHandle): void {
    this.timers.start(handle);
  }

  now(): number {
    const now = this.#clock.now();

    if (!Number.isFinite(now)) {
      throw new Error('Clock returned a non-finite value.');
    }

    return now;
  }

  startWithElapsed(handle: TimerHandle, elapsedMs: number, sampledNow?: number): void {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      throw new RangeError('Initial elapsed time must be finite and non-negative.');
    }

    const now = sampledNow ?? this.now();

    if (!Number.isFinite(now)) {
      throw new Error('Clock returned a non-finite value.');
    }

    this.timers.startAt(handle, now - elapsedMs, now);
  }

  clear(handle: TimerHandle): void {
    this.timers.clear(handle);
  }

  elapsed(handle: TimerHandle): number {
    return this.timers.elapsed(handle);
  }

  scheduleDeadline(handle: TimerHandle, deadline: number, payload = 0): number {
    if (!this.timers.has(handle)) {
      throw new Error('Deadline references an unknown timer.');
    }

    return this.deadlines.schedule(deadline, ScheduledEventKind.TimerDeadline, handle, payload);
  }

  cancelDeadline(eventId: number): boolean {
    return this.deadlines.cancel(eventId);
  }

  drainDue(now = this.#clock.now(), limit = 10_000): ScheduledEvent[] {
    return this.deadlines.popDue(now, limit);
  }

  metrics(): EngineMetrics {
    return {
      timers: this.timers.size,
      activeTimers: this.timers.activeCount,
      capacity: this.timers.capacity,
      scheduledEvents: this.deadlines.size,
      nextDeadline: this.deadlines.nextDeadline,
    };
  }
}

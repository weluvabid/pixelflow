import type { Clock } from './clock.ts';
import { ChronosError, type TimerHandle } from './types.ts';

const INITIAL_CAPACITY = 1024;
const MAX_CAPACITY = 0x7fffffff;

export class TimerRegistry {
  #startedAt: Float64Array;
  #size = 0;
  #activeCount = 0;
  #lastClockTime = Number.NEGATIVE_INFINITY;
  readonly #clock: Clock;

  constructor(clock: Clock, initialCapacity = INITIAL_CAPACITY) {
    if (
      !Number.isSafeInteger(initialCapacity) ||
      initialCapacity < 1 ||
      initialCapacity > MAX_CAPACITY
    ) {
      throw new RangeError(
        'Initial capacity must be a positive safe integer within the supported limit.',
      );
    }

    this.#clock = clock;
    this.#startedAt = new Float64Array(initialCapacity);

    this.#startedAt.fill(Number.NaN);
  }

  get size(): number {
    return this.#size;
  }
  get capacity(): number {
    return this.#startedAt.length;
  }
  get activeCount(): number {
    return this.#activeCount;
  }

  create(): TimerHandle {
    if (this.#size === this.#startedAt.length) {
      this.#grow();
    }

    return this.#size++;
  }

  start(id: TimerHandle): void {
    this.#assertId(id);
    const now = this.#clockNow();

    if (Number.isNaN(this.#startedAt[id])) {
      this.#activeCount++;
    }

    this.#startedAt[id] = now;
  }

  startAt(id: TimerHandle, startedAt: number, sampledNow?: number): void {
    this.#assertId(id);

    if (!Number.isFinite(startedAt)) {
      throw new ChronosError('Timer start timestamp must be finite.', 'CLOCK_INVALID');
    }

    const now = sampledNow === undefined ? this.#clockNow() : this.#observeClock(sampledNow);

    if (startedAt > now) {
      throw new ChronosError('Timer start timestamp cannot be in the future.', 'CLOCK_REGRESSION');
    }

    if (Number.isNaN(this.#startedAt[id])) {
      this.#activeCount++;
    }

    this.#startedAt[id] = startedAt;
  }

  clear(id: TimerHandle): void {
    this.#assertId(id);

    if (!Number.isNaN(this.#startedAt[id])) {
      this.#activeCount--;
    }

    this.#startedAt[id] = Number.NaN;
  }

  reset(): void {
    this.#startedAt.fill(Number.NaN);

    this.#size = 0;
    this.#activeCount = 0;
    this.#lastClockTime = Number.NEGATIVE_INFINITY;
  }

  has(id: TimerHandle): boolean {
    return Number.isSafeInteger(id) && id >= 0 && id < this.#size;
  }

  startedAt(id: TimerHandle): number {
    this.#assertId(id);
    const value = this.#startedAt[id];

    if (value === undefined) {
      throw new ChronosError(`Missing timestamp at index ${id}.`, 'STORAGE_CORRUPT');
    }

    return value;
  }

  elapsed(id: TimerHandle, at = this.#clockNow()): number {
    const startedAt = this.startedAt(id);

    if (Number.isNaN(startedAt)) {
      return 0;
    }

    if (!Number.isFinite(at) || at < startedAt) {
      throw new ChronosError('Elapsed-time sample predates the call start.', 'CLOCK_REGRESSION');
    }

    return at - startedAt;
  }

  windowBuffers(
    offset: number,
    limit: number,
  ): {
    readonly offset: number;
    readonly total: number;
    readonly startedAt: Float64Array;
  } {
    this.#validateWindow(offset, limit);
    const count = Math.min(limit, Math.max(0, this.#size - offset));

    return { offset, total: this.#size, startedAt: this.#startedAt.slice(offset, offset + count) };
  }

  #validateWindow(offset: number, limit: number): void {
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new RangeError('Offset must be a non-negative safe integer.');
    }

    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 10_000) {
      throw new RangeError('Limit must be between 0 and 10000.');
    }
  }

  #assertId(id: TimerHandle): void {
    if (!this.has(id)) {
      throw new ChronosError('Timer identifier is invalid.', 'INVALID_TIMER_ID');
    }
  }

  #clockNow(): number {
    return this.#observeClock(this.#clock.now());
  }

  #observeClock(now: number): number {
    if (!Number.isFinite(now)) {
      throw new ChronosError('Clock returned a non-finite value.', 'CLOCK_INVALID');
    }

    if (now < this.#lastClockTime) {
      throw new ChronosError('Monotonic clock moved backwards.', 'CLOCK_REGRESSION');
    }

    this.#lastClockTime = now;

    return now;
  }

  #grow(): void {
    if (this.#startedAt.length >= MAX_CAPACITY) {
      throw new ChronosError('Timer registry capacity exhausted.', 'CAPACITY_EXHAUSTED');
    }

    const next = Math.min(MAX_CAPACITY, this.#startedAt.length * 2);
    const expanded = new Float64Array(next);

    expanded.fill(Number.NaN);
    expanded.set(this.#startedAt);

    this.#startedAt = expanded;
  }
}

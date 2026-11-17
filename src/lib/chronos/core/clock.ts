/** A monotonic millisecond clock aligned across the window and its workers. */
export interface Clock {
  now(): number;
}

export class PerformanceClock implements Clock {
  #lastTime = Number.NEGATIVE_INFINITY;
  readonly #read: () => number;

  constructor(read: () => number = () => performance.timeOrigin + performance.now()) {
    this.#read = read;
  }

  now(): number {
    const current = this.#read();

    if (!Number.isFinite(current)) {
      throw new RangeError('Performance clock returned a non-finite value.');
    }

    this.#lastTime = Math.max(this.#lastTime, current);

    return this.#lastTime;
  }
}

/** Deterministic clock for tests and reproducible simulations. */
export class ManualClock implements Clock {
  #time: number;

  constructor(initialTime = 0) {
    if (!Number.isFinite(initialTime)) {
      throw new RangeError('Initial clock time must be finite.');
    }

    this.#time = initialTime;
  }

  now(): number {
    return this.#time;
  }

  advance(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new RangeError('Clock can only advance by a finite, non-negative duration.');
    }

    this.#time += milliseconds;
  }

  set(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < this.#time) {
      throw new RangeError('A monotonic clock cannot move backwards.');
    }

    this.#time = milliseconds;
  }
}

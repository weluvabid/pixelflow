import type { ChronosEngine } from '../core/engine.ts';
import { mulberry32Output } from './random.ts';

export interface TimerRecord {
  readonly handle: number;
  readonly startedAt: number;
}

export interface TimerWindow {
  readonly offset: number;
  readonly total: number;
  readonly records: readonly TimerRecord[];
}

export interface TimerWindowBuffers {
  readonly offset: number;
  readonly total: number;
  readonly startedAt: Float64Array;
}

export const MAX_INITIAL_ELAPSED_MS = 5 * 60 * 1_000;

export interface TimerMatrixSummary {
  readonly seed: number;
  readonly timers: number;
}

/** Creates a deterministic population of continuously running timers. */
export class TimerMatrixSimulation {
  readonly engine: ChronosEngine;
  readonly seed: number;
  #count = 0;

  constructor(engine: ChronosEngine, seed = 0x00c0ffee) {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new RangeError('Simulation seed must be a uint32.');
    }

    this.engine = engine;
    this.seed = seed;
  }

  initialize(count: number): TimerMatrixSummary {
    if (!Number.isSafeInteger(count) || count < 0 || count > 100_000) {
      throw new RangeError('Simulation size must be between 0 and 100000.');
    }

    if (this.engine.timers.size !== 0) {
      throw new Error('Simulation can only initialize an empty engine.');
    }

    try {
      let randomState = this.seed;
      const startedAtBase = count === 0 ? 0 : this.engine.now();

      for (let index = 0; index < count; index += 1) {
        const handle = this.engine.createTimer();

        if (handle !== index) {
          throw new Error(`Timer index ${handle} does not match matrix index ${index}.`);
        }

        randomState = (randomState + 0x6d2b79f5) >>> 0;

        const initialElapsed = Math.floor(
          mulberry32Output(randomState) * (MAX_INITIAL_ELAPSED_MS + 1),
        );

        this.engine.startWithElapsed(handle, initialElapsed, startedAtBase);
      }

      this.#count = count;
    } catch (error) {
      this.engine.timers.reset();

      this.#count = 0;

      throw error;
    }

    return this.summary();
  }

  windowBuffers(offset: number, limit: number): TimerWindowBuffers {
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new RangeError('Offset must be a non-negative safe integer.');
    }

    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 10_000) {
      throw new RangeError('Limit must be between 0 and 10000.');
    }

    const count = Math.min(limit, Math.max(0, this.#count - offset));

    return {
      offset,
      total: this.#count,
      startedAt: this.engine.timers.windowBuffers(offset, count).startedAt,
    };
  }

  summary(): TimerMatrixSummary {
    if (this.engine.timers.size !== this.#count) {
      throw new Error('Timer population is inconsistent with the engine registry.');
    }

    return { seed: this.seed, timers: this.#count };
  }
}

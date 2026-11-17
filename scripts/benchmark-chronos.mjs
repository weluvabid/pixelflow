import { performance } from 'node:perf_hooks';
import { ManualClock } from '../src/lib/chronos/core/clock.ts';
import { ChronosEngine } from '../src/lib/chronos/core/engine.ts';
import { TimerMatrixSimulation } from '../src/lib/chronos/simulation/timer-matrix.ts';

const count = Number(process.env.CHRONOS_TIMERS ?? 100_000);
const windowLimit = Math.min(256, count);
const windowOffset = Math.max(0, Math.min(50_000, count - windowLimit));
const clock = new ManualClock(1_000);
const engine = new ChronosEngine(clock);
const simulation = new TimerMatrixSimulation(engine, 0x00c0ffee);

/**
 * @template T
 * @param {() => T} operation
 */
function measure(operation) {
  const startedAt = performance.now();
  const result = operation();

  return {
    durationMs: Number((performance.now() - startedAt).toFixed(3)),
    result,
  };
}

const initialization = measure(() => simulation.initialize(count));

clock.advance(1_000);

const registryWindow = measure(() => engine.timers.windowBuffers(windowOffset, windowLimit));
const simulationWindow = measure(() => simulation.windowBuffers(windowOffset, windowLimit));
const elapsedWindow = measure(() => {
  const now = clock.now();

  return Array.from(simulationWindow.result.startedAt, (startedAt) => now - startedAt);
});
const metrics = engine.metrics();

process.stdout.write(
  `${JSON.stringify(
    {
      environment: {
        runtime: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      workload: {
        count,
        seed: simulation.seed,
      },
      timings: {
        initializeMs: initialization.durationMs,
        registryWindowMs: registryWindow.durationMs,
        simulationWindowMs: simulationWindow.durationMs,
        elapsedWindowMs: elapsedWindow.durationMs,
      },
      metrics,
      windows: {
        records: simulationWindow.result.startedAt.length,
        transferredBytes: simulationWindow.result.startedAt.byteLength,
        elapsedSamples: elapsedWindow.result.length,
      },
      registryTypedArrayBytes: metrics.capacity * Float64Array.BYTES_PER_ELEMENT,
    },
    null,
    2,
  )}\n`,
);

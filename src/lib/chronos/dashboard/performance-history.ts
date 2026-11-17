/** Append a sample without allowing the rolling history to grow beyond its capacity. */
export function appendPerformanceSample(
  samples: readonly number[],
  sample: number,
  capacity: number,
): number[] {
  if (!Number.isFinite(sample) || sample < 0) {
    throw new RangeError('Performance sample must be a finite, non-negative number.');
  }

  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new RangeError('Performance history capacity must be a positive safe integer.');
  }

  const start = Math.max(0, samples.length - capacity + 1);

  return [...samples.slice(start), sample];
}

/** Build the SVG polyline coordinates for a bounded render-duration history. */
export function buildPerformancePolyline(
  samples: readonly number[],
  width = 320,
  height = 70,
  padding = 9,
): string {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new RangeError('Graph dimensions must be finite and positive.');
  }

  if (!Number.isFinite(padding) || padding < 0 || padding * 2 >= height) {
    throw new RangeError(
      'Graph padding must be non-negative and smaller than half the graph height.',
    );
  }

  if (samples.some((sample) => !Number.isFinite(sample) || sample < 0)) {
    throw new RangeError('Performance history contains an invalid sample.');
  }

  if (samples.length === 0) {
    return '';
  }

  const max = Math.max(
    1,
    samples.reduce((current, sample) => Math.max(current, sample), 0),
  );
  const drawableHeight = height - padding * 2;
  const lastIndex = samples.length - 1;

  return samples
    .map((sample, index) => {
      const x = lastIndex === 0 ? 0 : (index / lastIndex) * width;
      const y = height - padding - (sample / max) * drawableHeight;

      return `${x},${y}`;
    })
    .join(' ');
}

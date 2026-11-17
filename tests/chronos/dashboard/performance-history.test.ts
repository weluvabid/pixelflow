import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendPerformanceSample,
  buildPerformancePolyline,
} from '../../../src/lib/chronos/dashboard/performance-history.ts';

test('performance history remains bounded while preserving sample order', () => {
  assert.deepEqual(appendPerformanceSample([1, 2, 3], 4, 3), [2, 3, 4]);
  assert.deepEqual(appendPerformanceSample([], 4, 3), [4]);
});

test('performance polyline scales samples using one stable graph range', () => {
  assert.equal(buildPerformancePolyline([0, 5, 10], 100, 50, 5), '0,45 50,25 100,5');
  assert.equal(buildPerformancePolyline([]), '');
});

test('performance history rejects invalid samples and dimensions', () => {
  assert.throws(() => appendPerformanceSample([1], -1, 3), RangeError);
  assert.throws(() => appendPerformanceSample([], 1, 0), RangeError);
  assert.throws(() => buildPerformancePolyline([Number.NaN]), RangeError);
  assert.throws(() => buildPerformancePolyline([1], 0, 50), RangeError);
});

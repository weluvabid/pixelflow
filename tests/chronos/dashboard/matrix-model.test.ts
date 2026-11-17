import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getTimerRecord,
  getMatrixColumns,
  getVisibleTimerRange,
  getVisibleMatrixRows,
  timerId,
  timerName,
  timerStatus,
  MATRIX_ROW_HEIGHT,
} from '../../../src/lib/chronos/dashboard/matrix-model.ts';

test('timerId formats stable, one-based display identifiers', () => {
  assert.equal(timerId(0), 'TMR-000001');
  assert.equal(timerId(99_999), 'TMR-100000');
  assert.throws(() => timerId(-1), RangeError);
});

test('getTimerRecord resolves started-at records against a contiguous page', () => {
  const records = [
    { handle: 10, startedAt: 0 },
    { handle: 11, startedAt: 1 },
  ];
  assert.equal(getTimerRecord(records, 10, 11), records[1]);
  assert.equal(getTimerRecord(records, 10, 9), undefined);
  assert.equal(getTimerRecord(records, 10, 12), undefined);
});

test('getVisibleTimerRange calculates viewport handles with bounded overscan', () => {
  assert.deepEqual(getVisibleTimerRange(MATRIX_ROW_HEIGHT, MATRIX_ROW_HEIGHT, 10, 1_000, 1), {
    first: 0,
    last: 11,
  });
  assert.deepEqual(getVisibleTimerRange(0, MATRIX_ROW_HEIGHT, 10, 100, 4), { first: 0, last: 19 });
  assert.deepEqual(getVisibleTimerRange(0, 18, 0, 0), { first: 0, last: 0 });
});

test('getVisibleMatrixRows calculates visible rows and overscan without a virtualizer', () => {
  assert.deepEqual(getVisibleMatrixRows(MATRIX_ROW_HEIGHT * 2, MATRIX_ROW_HEIGHT * 2, 10, 1), {
    first: 1,
    last: 4,
  });
  assert.deepEqual(getVisibleMatrixRows(0, MATRIX_ROW_HEIGHT, 10, 4), { first: 0, last: 4 });
  assert.deepEqual(getVisibleMatrixRows(10_000, MATRIX_ROW_HEIGHT, 10, 2), { first: 7, last: 9 });
  assert.deepEqual(getVisibleMatrixRows(0, 18, 0), { first: 0, last: -1 });
});

test('matrix columns adapt to viewport width so timer cards remain readable', () => {
  assert.equal(getMatrixColumns(1_456), 4);
  assert.equal(getMatrixColumns(1_000), 4);
  assert.equal(getMatrixColumns(720), 2);
  assert.equal(getMatrixColumns(390), 1);
  assert.throws(() => getMatrixColumns(0), RangeError);
});

test('visible timer range uses the active responsive column count', () => {
  assert.deepEqual(getVisibleTimerRange(0, 92, 20, 1_000, 0, 1), { first: 0, last: 0 });
  assert.deepEqual(getVisibleTimerRange(0, 92, 20, 1_000, 0, 4), { first: 0, last: 3 });
});

test('timerName is deterministic and distributes synthetic workload labels', () => {
  assert.equal(timerName(0), timerName(0));
  assert.equal(timerName(0), 'Cache Reconciliation');
  assert.equal(timerName(1), 'Webhook Delivery');
  assert.equal(timerName(12), 'Cache Reconciliation');
  assert.throws(() => timerName(-1), RangeError);
});

test('timerStatus assigns stable synthetic states without changing timer records', () => {
  assert.equal(timerStatus(0), 'running');
  assert.equal(timerStatus(13), 'running');
  assert.equal(timerStatus(14), 'paused');
  assert.equal(timerStatus(16), 'paused');
  assert.equal(timerStatus(17), 'degraded');
  assert.equal(timerStatus(19), 'degraded');
  assert.equal(timerStatus(20), 'running');
  assert.throws(() => timerStatus(-1), RangeError);
});

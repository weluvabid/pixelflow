import assert from 'node:assert/strict';
import test from 'node:test';
import { getMatrixColumns } from './matrix-layout.ts';

void test('matrix columns adapt to viewport width', () => {
  assert.equal(getMatrixColumns(1_456), 4);
  assert.equal(getMatrixColumns(900), 4);
  assert.equal(getMatrixColumns(720), 2);
  assert.equal(getMatrixColumns(600), 2);
  assert.equal(getMatrixColumns(390), 1);
});

void test('matrix layout rejects invalid viewport widths', () => {
  for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => getMatrixColumns(width), RangeError);
  }
});

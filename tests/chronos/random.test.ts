import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32Output } from '../../src/lib/chronos/simulation/random.ts';

test('Mulberry32 output is deterministic and bounded for uint32 states', () => {
  assert.equal(mulberry32Output(0x12345678), mulberry32Output(0x12345678));
  assert.ok(mulberry32Output(0) >= 0 && mulberry32Output(0) < 1);
  assert.ok(mulberry32Output(0xffffffff) >= 0 && mulberry32Output(0xffffffff) < 1);
  assert.throws(() => mulberry32Output(-1), RangeError);
  assert.throws(() => mulberry32Output(0x1_0000_0000), RangeError);
});

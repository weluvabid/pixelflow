/** Pure Mulberry32 output transform for one uint32 PRNG state. */
export function mulberry32Output(state: number): number {
  if (!Number.isSafeInteger(state) || state < 0 || state > 0xffffffff) {
    throw new RangeError('PRNG state must be a uint32.');
  }

  let value = state;

  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

  return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
}

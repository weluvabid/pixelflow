import assert from 'node:assert/strict';
import test from 'node:test';
import { optimizedImageUrl } from '../../src/lib/pixelflow/images.ts';

test('optimized image URLs preserve the source and apply bounded delivery parameters', () => {
  const result = new URL(
    optimizedImageUrl('https://images.unsplash.com/photo-example?ixlib=rb-4.0.3'),
  );

  assert.equal(result.origin, 'https://images.unsplash.com');
  assert.equal(result.pathname, '/photo-example');
  assert.equal(result.searchParams.get('w'), '480');
  assert.equal(result.searchParams.get('h'), '480');
  assert.equal(result.searchParams.get('fit'), 'crop');
  assert.equal(result.searchParams.get('crop'), 'entropy');
  assert.equal(result.searchParams.get('auto'), 'format');
  assert.equal(result.searchParams.get('q'), '78');
  assert.equal(result.searchParams.get('ixlib'), 'rb-4.0.3');
});

test('optimized image URL rejects malformed input', () => {
  assert.throws(() => optimizedImageUrl('not a URL'), TypeError);
});

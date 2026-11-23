import assert from 'node:assert/strict';
import test from 'node:test';
import { ImageCache } from '../../src/lib/pixelflow/dashboard/image-cache.ts';
import type { PhotoRecord } from '../../src/lib/pixelflow/images.ts';

const record: PhotoRecord = {
  id: 'photo-1',
  imageUrl: 'https://images.unsplash.com/photo-1',
  width: 1200,
  height: 800,
  photographer: 'Test Photographer',
};

function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (predicate()) {
        resolve();

        return;
      }

      if (Date.now() - started >= timeoutMs) {
        reject(new Error('Timed out waiting for image cache state.'));

        return;
      }

      setTimeout(poll, 2);
    };

    poll();
  });
}

test('retries transient fetch failures with bounded attempts', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  let attempts = 0;
  let changed = false;

  globalThis.fetch = async () => {
    attempts += 1;

    if (attempts < 3) {
      throw new TypeError('Temporary network failure.');
    }

    return new Response(new Blob(['image']), { status: 200 });
  };
  globalThis.createImageBitmap = async () => ({ width: 10, height: 10, close() {} }) as ImageBitmap;

  const cache = new ImageCache(
    () => {
      changed = true;
    },
    (error) => {
      assert.fail(error.message);
    },
    {
      fetchTimeoutMs: 100,
      maxRetries: 2,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 2,
      random: () => 0,
    },
  );

  try {
    cache.updateViewport([record], []);
    await waitFor(() => changed);

    assert.equal(attempts, 3);
    assert.equal(cache.size, 1);
  } finally {
    cache.destroy();
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test('times out a stalled request, releases its slot and retries', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  let attempts = 0;
  let changed = false;

  globalThis.fetch = async (_input, init) => {
    attempts += 1;

    if (attempts === 1) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted.', 'AbortError')),
          { once: true },
        );
      });
    }

    return new Response(new Blob(['image']), { status: 200 });
  };
  globalThis.createImageBitmap = async () => ({ width: 10, height: 10, close() {} }) as ImageBitmap;

  const cache = new ImageCache(
    () => {
      changed = true;
    },
    (error) => {
      assert.fail(error.message);
    },
    {
      fetchTimeoutMs: 10,
      maxRetries: 1,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 1,
      random: () => 0,
    },
  );

  try {
    cache.updateViewport([record], []);
    await waitFor(() => changed);

    assert.equal(attempts, 2);
    assert.equal(cache.size, 1);
  } finally {
    cache.destroy();
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test('does not retry permanent HTTP failures', async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  let reported = 0;

  globalThis.fetch = async () => {
    attempts += 1;

    return new Response(null, { status: 404 });
  };

  const cache = new ImageCache(
    () => undefined,
    () => {
      reported += 1;
    },
    {
      fetchTimeoutMs: 100,
      maxRetries: 2,
      retryBaseDelayMs: 1,
      random: () => 0,
    },
  );

  try {
    cache.updateViewport([record], []);
    await waitFor(() => reported === 1);
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(attempts, 1);
    assert.equal(reported, 1);
  } finally {
    cache.destroy();
    globalThis.fetch = originalFetch;
  }
});

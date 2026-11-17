import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VisibleWindowController,
  type WindowPage,
} from '../../../src/lib/pixelflow/dashboard/visible-window.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('visible-window requests are bounded and coalesce rapid range changes', async () => {
  let range = { first: 0, last: 29 };
  let cached: WindowPage<number> | null = null;
  const calls: { offset: number; limit: number }[] = [];
  const firstQuery = deferred<WindowPage<number>>();
  const received: WindowPage<number>[] = [];
  const controller = new VisibleWindowController<number>({
    query: (offset, limit) => {
      calls.push({ offset, limit });
      return calls.length === 1
        ? firstQuery.promise
        : Promise.resolve({
            offset,
            total: 100_000,
            records: Array.from({ length: limit }, (_, i) => offset + i),
          });
    },
    getRange: () => range,
    hasCachedRange: (next) =>
      cached !== null &&
      next.first >= cached.offset &&
      next.last < cached.offset + cached.records.length,
    getExpectedTotal: () => 100_000,
    onPage: (page) => {
      cached = page;
      received.push(page);
    },
    onError: (error) => {
      throw error;
    },
  });

  controller.request();
  range = { first: 500, last: 529 };
  controller.request();
  firstQuery.resolve({
    offset: 0,
    total: 100_000,
    records: Array.from({ length: 30 }, (_, i) => i),
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, [
    { offset: 0, limit: 30 },
    { offset: 500, limit: 30 },
  ]);
  assert.equal(received.length, 1);
  assert.equal(received[0]?.offset, 500);
  controller.close();
});

test('visible-window controller rejects mismatched totals and stops after close', async () => {
  let errors = 0;
  let queries = 0;
  const controller = new VisibleWindowController<number>({
    query: async (offset, limit) => {
      queries++;
      return { offset, total: 99, records: Array.from({ length: limit }, () => 0) };
    },
    getRange: () => ({ first: 0, last: 2 }),
    hasCachedRange: () => false,
    getExpectedTotal: () => 100,
    onPage: () => assert.fail('Invalid page must not be published.'),
    onError: () => {
      errors++;
    },
  });

  controller.request();
  await new Promise((resolve) => setImmediate(resolve));
  controller.close();
  controller.request(true);
  assert.equal(queries, 1);
  assert.equal(errors, 1);
});

test('visible-window controller enforces the configured maximum range', async () => {
  let requestedLimit = 0;
  const controller = new VisibleWindowController<number>({
    query: async (offset, limit) => {
      requestedLimit = limit;
      return { offset, total: 10_000, records: Array.from({ length: limit }, () => 0) };
    },
    getRange: () => ({ first: 0, last: 9_999 }),
    hasCachedRange: () => false,
    getExpectedTotal: () => 10_000,
    onPage: () => {},
    onError: (error) => {
      throw error;
    },
    maxLimit: 128,
  });

  controller.request();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requestedLimit, 128);
  controller.close();
});

test('visible-window query failure clears coalesced work instead of retrying in a loop', async () => {
  let rejectQuery: ((error: Error) => void) | undefined;
  let queryCount = 0;
  let errorCount = 0;
  let range = { first: 0, last: 3 };
  const controller = new VisibleWindowController<number>({
    query: () => {
      queryCount += 1;

      return new Promise((_, reject) => {
        rejectQuery = reject;
      });
    },
    getRange: () => range,
    hasCachedRange: () => false,
    getExpectedTotal: () => 100,
    onPage: () => {},
    onError: () => {
      errorCount += 1;
    },
  });

  const firstRequest = controller.request();
  range = { first: 4, last: 7 };
  const coalescedRequest = controller.request();
  rejectQuery?.(new Error('worker unavailable'));
  await Promise.all([firstRequest, coalescedRequest]);

  assert.equal(queryCount, 1);
  assert.equal(errorCount, 1);
  controller.close();
});

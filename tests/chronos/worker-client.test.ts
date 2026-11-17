import test from 'node:test';
import assert from 'node:assert/strict';
import { ChronosWorkerClient } from '../../src/lib/chronos/worker/client.ts';
import type { WorkerResponse } from '../../src/lib/chronos/worker/protocol.ts';

class FakeWorker {
  readonly listeners = new Map<string, ((event: never) => void)[]>();
  readonly sent: unknown[] = [];
  terminated = false;
  postMessage(message: unknown): void {
    this.sent.push(message);
  }
  addEventListener(type: string, listener: (event: never) => void): void {
    const listeners = this.listeners.get(type) ?? [];

    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  terminate(): void {
    this.terminated = true;
  }
  emitMessage(message: WorkerResponse): void {
    for (const listener of this.listeners.get('message') ?? []) {
      listener({ data: message } as never);
    }
  }
}

test('worker client correlates responses and enforces request backpressure', async () => {
  const worker = new FakeWorker();
  const client = new ChronosWorkerClient(worker as never, 1_000);
  const requests = Array.from({ length: 65 }, () => client.metrics());
  const overflowRequest = requests.at(64);

  assert.ok(overflowRequest !== undefined);
  const overflow = overflowRequest.then(
    () => null,
    (error: unknown) => error,
  );

  worker.emitMessage({ version: 1, requestId: 0, type: 'READY' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(worker.sent.length, 64);
  const overflowError = await overflow;

  assert.ok(overflowError instanceof Error);
  assert.match(overflowError.message, /request queue is full/);

  const first = worker.sent[0] as { requestId: number };

  worker.emitMessage({
    version: 1,
    requestId: first.requestId,
    type: 'METRICS',
    metrics: {
      timers: 4,
      activeTimers: 3,
      capacity: 8,
      scheduledEvents: 0,
      nextDeadline: null,
    },
  });
  assert.deepEqual(await requests[0], {
    timers: 4,
    activeTimers: 3,
    capacity: 8,
    scheduledEvents: 0,
    nextDeadline: null,
  });
  client.close();
  assert.equal(worker.terminated, true);
  await Promise.allSettled(requests.slice(1, 64));
});

test('worker client rejects pending work after worker failure', async () => {
  const worker = new FakeWorker();
  const client = new ChronosWorkerClient(worker as never, 1_000);
  const pending = client.metrics();

  for (const listener of worker.listeners.get('error') ?? []) {
    listener({ message: 'boom' } as never);
  }

  await assert.rejects(pending, /boom/);
  assert.equal(worker.terminated, true);
});

test('worker client terminates on an invalid response envelope', async () => {
  const worker = new FakeWorker();
  const client = new ChronosWorkerClient(worker as never, 1_000);
  const pending = client.metrics();

  worker.emitMessage({ version: 1, requestId: 0, type: 'READY' });
  await new Promise((resolve) => setImmediate(resolve));
  worker.emitMessage({ version: 99, requestId: 0, type: 'READY' } as unknown as WorkerResponse);

  await assert.rejects(pending, /malformed or unsupported response/);
  assert.equal(worker.terminated, true);
});

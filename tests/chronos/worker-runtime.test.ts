import test from 'node:test';
import assert from 'node:assert/strict';
import { installWorkerRuntime } from '../../src/lib/chronos/worker/runtime.ts';
import type { WorkerRequest, WorkerResponse } from '../../src/lib/chronos/worker/protocol.ts';

class FakeWorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly messages: WorkerResponse[] = [];
  #nextTimeout = 1;
  readonly timeouts = new Map<number, () => void>();
  postMessage(message: unknown): void {
    this.messages.push(message as WorkerResponse);
  }
  setTimeout(handler: () => void, _timeout: number): number {
    const id = this.#nextTimeout++;

    this.timeouts.set(id, handler);

    return id;
  }
  clearTimeout(id: number): void {
    this.timeouts.delete(id);
  }
  fireNextTimeout(): void {
    const entry = this.timeouts.entries().next().value as [number, () => void] | undefined;

    if (entry === undefined) {
      throw new Error('No scheduled worker timeout to fire.');
    }

    this.timeouts.delete(entry[0]);
    entry[1]();
  }
  send(message: WorkerRequest): void {
    this.onmessage?.({ data: message } as MessageEvent<unknown>);
  }
  take(requestId: number): WorkerResponse | undefined {
    const index = this.messages.findIndex((message) => message.requestId === requestId);

    return index < 0 ? undefined : this.messages.splice(index, 1)[0];
  }
}

function request(
  requestId: number,
  type: WorkerRequest['type'],
  payload: Record<string, unknown> = {},
): WorkerRequest {
  return { version: 1, requestId, type, ...payload } as WorkerRequest;
}

test('worker protocol initializes simulation and returns only bounded typed-array windows', () => {
  const port = new FakeWorkerPort();

  installWorkerRuntime(port);
  assert.equal(port.messages[0]?.type, 'READY');

  port.send(request(1, 'LOAD_SIMULATION', { count: 1_000, seed: 42 }));
  const loaded = port.take(1);

  assert.equal(loaded?.type, 'SIMULATION');

  if (loaded?.type !== 'SIMULATION') {
    return;
  }

  assert.equal(loaded.summary.timers, 1_000);

  port.send(request(2, 'QUERY_WINDOW', { offset: 250, limit: 64 }));
  const window = port.take(2);

  assert.equal(window?.type, 'WINDOW');

  if (window?.type !== 'WINDOW') {
    return;
  }

  assert.equal(window.offset, 250);
  assert.equal(window.total, 1_000);
  assert.equal(window.startedAt.length, 64);

  port.send(request(3, 'METRICS'));
  const metrics = port.take(3);

  assert.equal(metrics?.type, 'METRICS');

  if (metrics?.type === 'METRICS') {
    assert.equal(metrics.metrics.timers, 1_000);
  }
});

test('worker rejects malformed and unexpected operations observably', () => {
  const port = new FakeWorkerPort();

  installWorkerRuntime(port);
  port.onmessage?.({
    data: { version: 99, requestId: 1, type: 'METRICS' },
  } as MessageEvent<unknown>);
  assert.equal(port.messages.at(-1)?.type, 'ERROR');

  if (port.messages.at(-1)?.type === 'ERROR') {
    assert.equal(port.messages.at(-1)?.code, 'INVALID_PROTOCOL_MESSAGE');
  }

  port.send(request(2, 'QUERY_WINDOW', { offset: 0, limit: 1 }));
  const response = port.take(2);

  assert.equal(response?.type, 'ERROR');

  if (response?.type === 'ERROR') {
    assert.match(response.message, /before the simulation has been initialized/);
  }
});

test('worker maintains one central timeout and emits due deadline events', () => {
  const port = new FakeWorkerPort();

  installWorkerRuntime(port);
  port.send(request(1, 'CREATE_TIMER', { startImmediately: true }));
  const created = port.take(1);

  assert.equal(created?.type, 'TIMER_CREATED');

  if (created?.type !== 'TIMER_CREATED') {
    return;
  }

  port.send(request(2, 'SCHEDULE_DEADLINE', { handle: created.handle, delayMs: 0, payload: 17 }));
  const scheduled = port.take(2);

  assert.equal(scheduled?.type, 'ACK');
  assert.equal(port.timeouts.size, 1);

  port.fireNextTimeout();
  const due = port.messages.find((message) => message.type === 'EVENTS_DUE');

  assert.equal(due?.type, 'EVENTS_DUE');

  if (due?.type === 'EVENTS_DUE') {
    assert.equal(due.events.length, 1);
    assert.equal(due.events[0]?.payload, 17);
  }
});

test('worker aggregates stale deadline failures instead of flooding the main thread', () => {
  const port = new FakeWorkerPort();

  installWorkerRuntime(port);
  port.send(request(1, 'CREATE_TIMER', { startImmediately: true }));
  const created = port.take(1);

  assert.equal(created?.type, 'TIMER_CREATED');

  if (created?.type !== 'TIMER_CREATED') {
    return;
  }

  port.send(request(2, 'SCHEDULE_DEADLINE', { handle: created.handle, delayMs: 0, payload: 1 }));
  port.take(2);
  port.send(request(3, 'SCHEDULE_DEADLINE', { handle: created.handle, delayMs: 0, payload: 2 }));
  port.take(3);
  assert.equal(port.timeouts.size, 1);

  port.send(request(4, 'TIMER_ACTION', { action: 'clear', handle: created.handle }));
  port.take(4);
  port.fireNextTimeout();

  const errors = port.messages.filter(
    (message) => message.type === 'ERROR' && message.requestId === 0,
  );

  assert.equal(errors.length, 1);

  if (errors[0]?.type === 'ERROR') {
    assert.equal(errors[0].code, 'TIMER_INACTIVE');
    assert.match(errors[0].message, /2 scheduled event\(s\) were discarded/);
  }
});

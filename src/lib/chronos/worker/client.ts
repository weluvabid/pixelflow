import type { EngineMetrics } from '../core/engine.ts';
import type { TimerHandle } from '../core/types.ts';
import {
  type TimerWindow,
  type TimerRecord,
  type TimerMatrixSummary,
} from '../simulation/timer-matrix.ts';
import type { ScheduledEvent } from '../scheduler/deadline-queue.ts';
import {
  isWorkerResponse,
  PROTOCOL_VERSION,
  type TimerAction,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol.ts';

interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerResponse>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  addEventListener(type: 'messageerror', listener: (event: MessageEvent) => void): void;
  terminate(): void;
}

type RequestWithoutEnvelope = WorkerRequest extends infer Request
  ? Request extends WorkerRequest
    ? Omit<Request, 'version' | 'requestId'>
    : never
  : never;

interface PendingRequest {
  readonly resolve: (response: WorkerResponse) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

export class ChronosWorkerClient {
  #nextRequestId = 1;
  #pending = new Map<number, PendingRequest>();
  #waitingRequests = 0;
  #closed = false;
  #readyResolve: () => void = () => {};
  #readyReject: (error: Error) => void = () => {};
  readonly ready: Promise<void>;
  readonly #worker: WorkerLike;
  readonly #requestTimeoutMs: number;
  onEventsDue: ((events: readonly ScheduledEvent[]) => void) | null = null;
  onRuntimeError: ((error: Error) => void) | null = null;

  constructor(worker: WorkerLike, requestTimeoutMs = 15_000) {
    this.#worker = worker;
    this.#requestTimeoutMs = requestTimeoutMs;

    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) {
      throw new RangeError('Request timeout must be a positive safe integer.');
    }

    this.ready = new Promise<void>((resolve, reject) => {
      this.#readyResolve = resolve;
      this.#readyReject = reject;
    });

    this.#worker.addEventListener('message', (event) => this.#onMessage(event.data));
    this.#worker.addEventListener('error', (event) =>
      this.#failAll(new Error(event.message || 'Chronos worker failed.')),
    );
    this.#worker.addEventListener('messageerror', () =>
      this.#failAll(new Error('Chronos worker message could not be deserialized.')),
    );
  }

  static create(): ChronosWorkerClient {
    return new ChronosWorkerClient(
      new Worker(new URL('./chronos.worker.ts', import.meta.url), { type: 'module' }),
    );
  }

  async createTimer(startImmediately = false): Promise<TimerHandle> {
    const response = await this.#request({ type: 'CREATE_TIMER', startImmediately });

    if (response.type !== 'TIMER_CREATED') {
      throw new Error(`Unexpected response ${response.type} for CREATE_TIMER.`);
    }

    return response.handle;
  }

  async act(action: TimerAction, handle: TimerHandle): Promise<void> {
    await this.#request({ type: 'TIMER_ACTION', action, handle });
  }

  async scheduleDeadline(handle: TimerHandle, delayMs: number, payload = 0): Promise<number> {
    const response = await this.#request({ type: 'SCHEDULE_DEADLINE', handle, delayMs, payload });

    if (response.type !== 'ACK' || typeof response.result !== 'number') {
      throw new Error('Worker returned an invalid schedule acknowledgement.');
    }

    return response.result;
  }

  async cancelDeadline(eventId: number): Promise<boolean> {
    const response = await this.#request({ type: 'CANCEL_DEADLINE', eventId });

    if (response.type !== 'ACK' || typeof response.result !== 'boolean') {
      throw new Error('Worker returned an invalid cancellation acknowledgement.');
    }

    return response.result;
  }

  async queryWindow(offset: number, limit: number): Promise<TimerWindow> {
    const response = await this.#request({ type: 'QUERY_WINDOW', offset, limit });

    if (response.type !== 'WINDOW') {
      throw new Error(`Unexpected response ${response.type} for QUERY_WINDOW.`);
    }

    if (response.offset !== offset) {
      throw new Error(`Worker returned window offset ${response.offset}; requested ${offset}.`);
    }

    const records: TimerRecord[] = Array.from(response.startedAt, (startedAt, index) => ({
      handle: offset + index,
      startedAt,
    }));

    return { offset: response.offset, total: response.total, records };
  }

  async metrics(): Promise<EngineMetrics> {
    const response = await this.#request({ type: 'METRICS' });

    if (response.type !== 'METRICS') {
      throw new Error(`Unexpected response ${response.type} for METRICS.`);
    }

    return response.metrics;
  }

  async loadSimulation(count: number, seed?: number): Promise<TimerMatrixSummary> {
    const response = await this.#request(
      seed === undefined
        ? { type: 'LOAD_SIMULATION', count }
        : { type: 'LOAD_SIMULATION', count, seed },
    );

    if (response.type !== 'SIMULATION') {
      throw new Error(`Unexpected response ${response.type} for LOAD_SIMULATION.`);
    }

    return response.summary;
  }

  async reconcile(): Promise<void> {
    await this.#request({ type: 'RECONCILE' });
  }

  close(): void {
    if (this.#closed) {
      return;
    }

    this.#failAll(new Error('Chronos worker client was closed.'));
  }

  #request(request: RequestWithoutEnvelope): Promise<WorkerResponse> {
    if (this.#closed) {
      return Promise.reject(new Error('Chronos worker client is closed.'));
    }

    if (this.#pending.size + this.#waitingRequests >= 64) {
      return Promise.reject(
        Object.assign(new Error('Chronos worker request queue is full.'), {
          code: 'CLIENT_BACKPRESSURE',
        }),
      );
    }

    this.#waitingRequests += 1;

    return this.ready.then(
      () => {
        this.#waitingRequests -= 1;

        if (this.#closed) {
          throw new Error('Chronos worker client is closed.');
        }

        return new Promise<WorkerResponse>((resolve, reject) => {
          const requestId = this.#nextRequestId++;

          if (!Number.isSafeInteger(requestId)) {
            reject(new Error('Chronos request identifier space exhausted.'));

            return;
          }

          const timeout = setTimeout(() => {
            this.#pending.delete(requestId);
            reject(new Error(`Chronos worker request ${request.type} timed out.`));
          }, this.#requestTimeoutMs);

          this.#pending.set(requestId, { resolve, reject, timeout });
          const message = { ...request, version: PROTOCOL_VERSION, requestId } as WorkerRequest;

          try {
            this.#worker.postMessage(message);
          } catch (error) {
            clearTimeout(timeout);
            this.#pending.delete(requestId);
            reject(
              error instanceof Error
                ? error
                : new Error('Unable to post message to Chronos worker.'),
            );
          }
        });
      },
      (error: unknown) => {
        this.#waitingRequests -= 1;

        throw error;
      },
    );
  }

  #onMessage(value: unknown): void {
    if (!isWorkerResponse(value)) {
      this.#failAll(new Error('Chronos worker sent a malformed or unsupported response.'));

      return;
    }

    const response = value;

    if (response.type === 'READY' && response.requestId === 0) {
      this.#readyResolve();

      return;
    }

    if (response.requestId === 0) {
      if (response.type === 'EVENTS_DUE') {
        this.onEventsDue?.(response.events);
      } else if (response.type === 'ERROR') {
        this.onRuntimeError?.(new Error(`${response.code}: ${response.message}`));
      }

      return;
    }

    const pending = this.#pending.get(response.requestId);

    if (pending === undefined) {
      return; // Late response after timeout; it must not resurrect a request.
    }

    clearTimeout(pending.timeout);
    this.#pending.delete(response.requestId);

    if (response.type === 'ERROR') {
      pending.reject(Object.assign(new Error(response.message), { code: response.code }));
    } else {
      pending.resolve(response);
    }
  }

  #failAll(error: Error): void {
    if (this.#closed) {
      return;
    }

    this.#closed = true;

    this.#worker.terminate();
    this.#readyReject(error);

    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }

    this.#pending.clear();
    this.onRuntimeError?.(error);
  }
}

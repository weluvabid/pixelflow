import { ChronosError, type TimerHandle } from '../core/types.ts';

export const ScheduledEventKind = Object.freeze({ TimerDeadline: 1, Custom: 2 } as const);

export type ScheduledEventKind = (typeof ScheduledEventKind)[keyof typeof ScheduledEventKind];

export interface ScheduledEvent {
  readonly id: number;
  readonly deadline: number;
  readonly kind: ScheduledEventKind;
  readonly handle: TimerHandle;
  readonly payload: number;
}

const INITIAL_CAPACITY = 64;

function readValue<T>(values: ArrayLike<T>, index: number, label: string): T {
  const value = values[index];

  if (value === undefined) {
    throw new ChronosError(`Missing ${label} at index ${index}.`, 'SCHEDULER_STORAGE_CORRUPT');
  }

  return value;
}

/** Indexed binary min-heap. Insert/remove are O(log n); next deadline is O(1). */
export class DeadlineQueue {
  #deadlines: Float64Array;
  #ids: Float64Array;
  #slots: Uint32Array;
  #kinds: Uint8Array;
  #payloads: Uint32Array;
  #positions = new Map<number, number>();
  #size = 0;
  #nextId = 1;

  constructor(initialCapacity = INITIAL_CAPACITY) {
    if (!Number.isSafeInteger(initialCapacity) || initialCapacity < 1) {
      throw new RangeError('Capacity must be positive.');
    }

    this.#deadlines = new Float64Array(initialCapacity);
    this.#ids = new Float64Array(initialCapacity);
    this.#slots = new Uint32Array(initialCapacity);
    this.#kinds = new Uint8Array(initialCapacity);
    this.#payloads = new Uint32Array(initialCapacity);
  }

  get size(): number {
    return this.#size;
  }
  get nextDeadline(): number | null {
    return this.#size === 0 ? null : readValue(this.#deadlines, 0, 'next deadline');
  }

  schedule(deadline: number, kind: ScheduledEventKind, handle: TimerHandle, payload = 0): number {
    if (!Number.isFinite(deadline)) {
      throw new RangeError('Deadline must be finite.');
    }

    if (kind !== ScheduledEventKind.TimerDeadline && kind !== ScheduledEventKind.Custom) {
      throw new ChronosError(`Unsupported event kind: ${kind}.`, 'UNSUPPORTED_EVENT_KIND');
    }

    if (!Number.isSafeInteger(handle) || handle < 0 || handle > 0xffffffff) {
      throw new RangeError('Timer identifier is invalid.');
    }

    if (!Number.isSafeInteger(payload) || payload < 0 || payload > 0xffffffff) {
      throw new RangeError('Payload must be uint32.');
    }

    const id = this.#nextId++;

    if (!Number.isSafeInteger(id)) {
      throw new ChronosError('Scheduler event identifier space exhausted.', 'EVENT_ID_EXHAUSTED');
    }

    this.#ensureCapacity();
    const index = this.#size++;

    this.#write(index, { id, deadline, kind, handle, payload });
    this.#positions.set(id, index);
    this.#siftUp(index);

    return id;
  }

  cancel(id: number): boolean {
    const index = this.#positions.get(id);

    if (index === undefined) {
      return false;
    }

    this.#removeAt(index);

    return true;
  }

  peek(): ScheduledEvent | null {
    return this.#size === 0 ? null : this.#read(0);
  }

  popDue(now: number, limit = 10_000): ScheduledEvent[] {
    if (!Number.isFinite(now)) {
      throw new RangeError('Current time must be finite.');
    }

    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100_000) {
      throw new RangeError('Due-event limit must be 1..100000.');
    }

    const due: ScheduledEvent[] = [];

    while (
      this.#size > 0 &&
      readValue(this.#deadlines, 0, 'next deadline') <= now &&
      due.length < limit
    ) {
      due.push(this.#removeAt(0));
    }

    return due;
  }

  #removeAt(index: number): ScheduledEvent {
    const removed = this.#read(index);

    this.#positions.delete(removed.id);
    const last = --this.#size;

    if (index !== last) {
      const replacement = this.#read(last);

      this.#write(index, replacement);
      this.#positions.set(replacement.id, index);

      if (index > 0 && this.#less(index, this.#parent(index))) {
        this.#siftUp(index);
      } else {
        this.#siftDown(index);
      }
    }

    return removed;
  }

  #siftUp(start: number): void {
    let index = start;

    while (index > 0) {
      const parent = this.#parent(index);

      if (!this.#less(index, parent)) {
        break;
      }

      this.#swap(index, parent);

      index = parent;
    }
  }

  #siftDown(start: number): void {
    let index = start;

    while (true) {
      const left = index * 2 + 1;

      if (left >= this.#size) {
        return;
      }

      const right = left + 1;
      const smallest = right < this.#size && this.#less(right, left) ? right : left;

      if (!this.#less(smallest, index)) {
        return;
      }

      this.#swap(index, smallest);

      index = smallest;
    }
  }

  #less(a: number, b: number): boolean {
    const deadlineA = readValue(this.#deadlines, a, 'deadline');
    const deadlineB = readValue(this.#deadlines, b, 'deadline');

    return (
      deadlineA < deadlineB ||
      (deadlineA === deadlineB &&
        readValue(this.#ids, a, 'event id') < readValue(this.#ids, b, 'event id'))
    );
  }

  #swap(a: number, b: number): void {
    const leftId = readValue(this.#ids, a, 'event id');
    const rightId = readValue(this.#ids, b, 'event id');
    let value: number;

    value = readValue(this.#deadlines, a, 'deadline');
    this.#deadlines[a] = readValue(this.#deadlines, b, 'deadline');
    this.#deadlines[b] = value;
    value = readValue(this.#ids, a, 'event id');
    this.#ids[a] = readValue(this.#ids, b, 'event id');
    this.#ids[b] = value;
    value = readValue(this.#slots, a, 'timer slot');
    this.#slots[a] = readValue(this.#slots, b, 'timer slot');
    this.#slots[b] = value;
    value = readValue(this.#kinds, a, 'event kind');
    this.#kinds[a] = readValue(this.#kinds, b, 'event kind');
    this.#kinds[b] = value;
    value = readValue(this.#payloads, a, 'event payload');
    this.#payloads[a] = readValue(this.#payloads, b, 'event payload');
    this.#payloads[b] = value;

    this.#positions.set(leftId, b);
    this.#positions.set(rightId, a);
  }

  #read(index: number): ScheduledEvent {
    return {
      id: readValue(this.#ids, index, 'event id'),
      deadline: readValue(this.#deadlines, index, 'deadline'),
      kind: readValue(this.#kinds, index, 'event kind') as ScheduledEventKind,
      handle: readValue(this.#slots, index, 'timer identifier'),
      payload: readValue(this.#payloads, index, 'event payload'),
    };
  }

  #write(index: number, event: ScheduledEvent): void {
    this.#ids[index] = event.id;
    this.#deadlines[index] = event.deadline;
    this.#slots[index] = event.handle;
    this.#kinds[index] = event.kind;
    this.#payloads[index] = event.payload;
  }

  #parent(index: number): number {
    return (index - 1) >>> 1;
  }

  #ensureCapacity(): void {
    if (this.#size < this.#deadlines.length) {
      return;
    }

    const next = this.#deadlines.length * 2;
    const grow = <T extends Float64Array | Uint32Array | Uint8Array>(source: T): T => {
      const target = new (source.constructor as { new (length: number): T })(next);

      target.set(source);

      return target;
    };

    this.#deadlines = grow(this.#deadlines);
    this.#ids = grow(this.#ids);
    this.#slots = grow(this.#slots);
    this.#kinds = grow(this.#kinds);
    this.#payloads = grow(this.#payloads);
  }
}

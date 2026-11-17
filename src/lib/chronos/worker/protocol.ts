import type { EngineMetrics } from '../core/engine.ts';
import type { TimerHandle } from '../core/types.ts';
import type { ScheduledEvent } from '../scheduler/deadline-queue.ts';
import type { TimerMatrixSummary } from '../simulation/timer-matrix.ts';

export const PROTOCOL_VERSION = 1;

export type TimerAction = 'start' | 'clear';

export type WorkerRequest =
  | {
      readonly version: 1;
      readonly requestId: number;
      readonly type: 'CREATE_TIMER';
      readonly startImmediately?: boolean;
    }
  | {
      readonly version: 1;
      readonly requestId: number;
      readonly type: 'TIMER_ACTION';
      readonly action: TimerAction;
      readonly handle: TimerHandle;
    }
  | {
      readonly version: 1;
      readonly requestId: number;
      readonly type: 'SCHEDULE_DEADLINE';
      readonly handle: TimerHandle;
      readonly delayMs: number;
      readonly payload?: number;
    }
  | {
      readonly version: 1;
      readonly requestId: number;
      readonly type: 'CANCEL_DEADLINE';
      readonly eventId: number;
    }
  | {
      readonly version: 1;
      readonly requestId: number;
      readonly type: 'QUERY_WINDOW';
      readonly offset: number;
      readonly limit: number;
    }
  | { readonly version: 1; readonly requestId: number; readonly type: 'METRICS' }
  | {
      readonly version: 1;
      readonly requestId: number;
      readonly type: 'LOAD_SIMULATION';
      readonly count: number;
      readonly seed?: number;
    }
  | { readonly version: 1; readonly requestId: number; readonly type: 'RECONCILE' };

interface ResponseBase {
  readonly version: 1;
  readonly requestId: number;
}

export type WorkerResponse =
  | (ResponseBase & { readonly type: 'READY' })
  | (ResponseBase & { readonly type: 'TIMER_CREATED'; readonly handle: TimerHandle })
  | (ResponseBase & { readonly type: 'ACK'; readonly result?: number | boolean })
  | (ResponseBase & {
      readonly type: 'WINDOW';
      readonly offset: number;
      readonly total: number;
      readonly startedAt: Float64Array;
    })
  | (ResponseBase & { readonly type: 'METRICS'; readonly metrics: EngineMetrics })
  | (ResponseBase & { readonly type: 'SIMULATION'; readonly summary: TimerMatrixSummary })
  | (ResponseBase & { readonly type: 'EVENTS_DUE'; readonly events: readonly ScheduledEvent[] })
  | (ResponseBase & { readonly type: 'ERROR'; readonly code: string; readonly message: string });

function isTimerHandle(value: unknown): value is TimerHandle {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 0xffffffff;
}

function isResponseBase(value: Record<string, unknown>): boolean {
  return (
    value.version === PROTOCOL_VERSION &&
    Number.isSafeInteger(value.requestId) &&
    (value.requestId as number) >= 0
  );
}

export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  if (!isResponseBase(candidate) || (candidate.requestId as number) === 0) {
    return false;
  }

  switch (candidate.type) {
    case 'CREATE_TIMER':
      return (
        candidate.startImmediately === undefined || typeof candidate.startImmediately === 'boolean'
      );
    case 'TIMER_ACTION':
      return (
        isTimerHandle(candidate.handle) && ['start', 'clear'].includes(String(candidate.action))
      );
    case 'SCHEDULE_DEADLINE':
      return (
        isTimerHandle(candidate.handle) &&
        typeof candidate.delayMs === 'number' &&
        Number.isFinite(candidate.delayMs) &&
        (candidate.delayMs as number) >= 0 &&
        (candidate.payload === undefined ||
          (Number.isSafeInteger(candidate.payload) &&
            (candidate.payload as number) >= 0 &&
            (candidate.payload as number) <= 0xffffffff))
      );
    case 'CANCEL_DEADLINE':
      return Number.isSafeInteger(candidate.eventId) && (candidate.eventId as number) > 0;
    case 'QUERY_WINDOW':
      return (
        Number.isSafeInteger(candidate.offset) &&
        (candidate.offset as number) >= 0 &&
        Number.isSafeInteger(candidate.limit) &&
        (candidate.limit as number) >= 0 &&
        (candidate.limit as number) <= 10_000
      );
    case 'METRICS':
    case 'RECONCILE':
      return true;
    case 'LOAD_SIMULATION':
      return (
        Number.isSafeInteger(candidate.count) &&
        (candidate.count as number) >= 0 &&
        (candidate.count as number) <= 100_000 &&
        (candidate.seed === undefined ||
          (Number.isSafeInteger(candidate.seed) &&
            (candidate.seed as number) >= 0 &&
            (candidate.seed as number) <= 0xffffffff))
      );
    default:
      return false;
  }
}

export function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  if (!isResponseBase(candidate)) {
    return false;
  }

  const requestId = candidate.requestId as number;

  switch (candidate.type) {
    case 'READY':
      return requestId === 0;
    case 'TIMER_CREATED':
      return requestId > 0 && isTimerHandle(candidate.handle);
    case 'ACK':
      return (
        requestId > 0 &&
        (candidate.result === undefined ||
          typeof candidate.result === 'boolean' ||
          (typeof candidate.result === 'number' && Number.isFinite(candidate.result)))
      );
    case 'WINDOW': {
      if (
        requestId === 0 ||
        !Number.isSafeInteger(candidate.offset) ||
        (candidate.offset as number) < 0 ||
        !Number.isSafeInteger(candidate.total) ||
        (candidate.total as number) < 0 ||
        !(candidate.startedAt instanceof Float64Array)
      ) {
        return false;
      }

      const count = candidate.startedAt.length;

      if (
        count > 10_000 ||
        (count > 0 && (candidate.offset as number) + count > (candidate.total as number))
      ) {
        return false;
      }

      for (const startedAt of candidate.startedAt) {
        if (!Number.isFinite(startedAt)) {
          return false;
        }
      }

      return true;
    }
    case 'METRICS': {
      if (requestId === 0 || typeof candidate.metrics !== 'object' || candidate.metrics === null) {
        return false;
      }

      const metrics = candidate.metrics as Record<string, unknown>;

      return (
        ['timers', 'activeTimers', 'capacity', 'scheduledEvents'].every(
          (key) => Number.isSafeInteger(metrics[key]) && (metrics[key] as number) >= 0,
        ) &&
        (metrics.activeTimers as number) <= (metrics.timers as number) &&
        (metrics.capacity as number) >= (metrics.timers as number) &&
        (metrics.nextDeadline === null ||
          (typeof metrics.nextDeadline === 'number' && Number.isFinite(metrics.nextDeadline)))
      );
    }
    case 'SIMULATION': {
      if (requestId === 0 || typeof candidate.summary !== 'object' || candidate.summary === null) {
        return false;
      }

      const summary = candidate.summary as Record<string, unknown>;

      return (
        ['seed', 'timers'].every(
          (key) => Number.isSafeInteger(summary[key]) && (summary[key] as number) >= 0,
        ) &&
        (summary.seed as number) <= 0xffffffff &&
        (summary.timers as number) <= 100_000
      );
    }
    case 'EVENTS_DUE': {
      if (requestId !== 0 || !Array.isArray(candidate.events)) {
        return false;
      }

      const events = candidate.events as unknown[];

      return events.every((event) => {
        if (typeof event !== 'object' || event === null) {
          return false;
        }

        const scheduled = event as Record<string, unknown>;

        return (
          Number.isSafeInteger(scheduled.id) &&
          (scheduled.id as number) > 0 &&
          typeof scheduled.deadline === 'number' &&
          Number.isFinite(scheduled.deadline) &&
          (scheduled.kind === 1 || scheduled.kind === 2) &&
          isTimerHandle(scheduled.handle) &&
          Number.isSafeInteger(scheduled.payload) &&
          (scheduled.payload as number) >= 0 &&
          (scheduled.payload as number) <= 0xffffffff
        );
      });
    }
    case 'ERROR':
      return typeof candidate.code === 'string' && typeof candidate.message === 'string';
    default:
      return false;
  }
}

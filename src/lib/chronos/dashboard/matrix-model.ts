import type { TimerRecord } from '../simulation/timer-matrix.ts';

export const MATRIX_COLUMNS = 4;
export const MATRIX_ROW_HEIGHT = 180;
export const MATRIX_CELL_GAP = 14;
export const MATRIX_CELL_HEIGHT = 164;
export const TARGET_TIMER_COUNT = 100_000;
export const INITIAL_WINDOW_SIZE = MATRIX_COLUMNS * 32;

export type TimerStatus = 'running' | 'paused' | 'degraded';

/** Stable presentation-only status; elapsed-time records remain unchanged. */
export function timerStatus(handle: number): TimerStatus {
  if (!Number.isSafeInteger(handle) || handle < 0) {
    throw new RangeError('Timer handle must be a non-negative safe integer.');
  }

  const bucket = handle % 20;

  if (bucket < 14) {
    return 'running';
  }

  if (bucket < 17) {
    return 'paused';
  }

  return 'degraded';
}

export function getMatrixColumns(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    throw new RangeError('Viewport width must be a finite positive number.');
  }

  if (viewportWidth >= 900) {
    return 4;
  }

  if (viewportWidth >= 600) {
    return 2;
  }

  return 1;
}

export interface MatrixRowRange {
  readonly first: number;
  readonly last: number;
}

export interface VisibleRange {
  readonly first: number;
  readonly last: number;
}

const WORKLOAD_NAMES = [
  'Cache Reconciliation',
  'Webhook Delivery',
  'Index Compaction',
  'Background Synchronization',
  'Queue Processing',
  'Session Maintenance',
  'Event Processing',
  'Database Maintenance',
  'Schedule Dispatch',
  'Snapshot Rotation',
  'Artifact Cleanup',
  'Connection Monitoring',
] as const;

/** Stable synthetic workload label derived solely from the timer handle. */
export function timerName(handle: number): string {
  if (!Number.isSafeInteger(handle) || handle < 0) {
    throw new RangeError('Timer handle must be a non-negative safe integer.');
  }

  const workload = WORKLOAD_NAMES[handle % WORKLOAD_NAMES.length];

  return workload;
}

export function timerId(handle: number): string {
  if (!Number.isSafeInteger(handle) || handle < 0) {
    throw new RangeError('Timer handle must be a non-negative safe integer.');
  }

  return `TMR-${String(handle + 1).padStart(6, '0')}`;
}

export function getTimerRecord(
  records: readonly TimerRecord[],
  windowOffset: number,
  handle: number,
): TimerRecord | undefined {
  const localIndex = handle - windowOffset;

  return localIndex >= 0 && localIndex < records.length ? records[localIndex] : undefined;
}

export function getVisibleTimerRange(
  scrollTop: number,
  viewportHeight: number,
  rowCount: number,
  timerCount: number,
  overscan = 4,
  columns = MATRIX_COLUMNS,
): VisibleRange {
  if (!Number.isSafeInteger(columns) || columns < 1) {
    throw new RangeError('Matrix columns must be a positive safe integer.');
  }

  if (timerCount <= 0 || rowCount <= 0) {
    return { first: 0, last: 0 };
  }

  if (!Number.isFinite(scrollTop) || scrollTop < 0) {
    throw new RangeError('Scroll offset must be a finite non-negative number.');
  }

  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    throw new RangeError('Viewport height must be a finite positive number.');
  }

  if (!Number.isSafeInteger(overscan) || overscan < 0) {
    throw new RangeError('Overscan must be a non-negative safe integer.');
  }

  const firstVisibleRow = Math.min(rowCount - 1, Math.floor(scrollTop / MATRIX_ROW_HEIGHT));
  const lastVisibleRow = Math.min(
    rowCount - 1,
    Math.max(firstVisibleRow, Math.ceil((scrollTop + viewportHeight) / MATRIX_ROW_HEIGHT) - 1),
  );
  const firstRow = Math.max(0, firstVisibleRow - overscan);
  const lastRow = Math.min(rowCount - 1, lastVisibleRow + overscan);

  return {
    first: firstRow * columns,
    last: Math.min((lastRow + 1) * columns - 1, timerCount - 1),
  };
}

export function getVisibleMatrixRows(
  scrollTop: number,
  viewportHeight: number,
  rowCount: number,
  overscan = 4,
): MatrixRowRange {
  if (rowCount <= 0) {
    return { first: 0, last: -1 };
  }

  if (!Number.isFinite(scrollTop) || scrollTop < 0) {
    throw new RangeError('Scroll offset must be a finite non-negative number.');
  }

  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    throw new RangeError('Viewport height must be a finite positive number.');
  }

  if (!Number.isSafeInteger(overscan) || overscan < 0) {
    throw new RangeError('Overscan must be a non-negative safe integer.');
  }

  const firstVisible = Math.min(rowCount - 1, Math.floor(scrollTop / MATRIX_ROW_HEIGHT));
  const lastVisible = Math.min(
    rowCount - 1,
    Math.max(firstVisible, Math.ceil((scrollTop + viewportHeight) / MATRIX_ROW_HEIGHT) - 1),
  );

  return {
    first: Math.max(0, firstVisible - overscan),
    last: Math.min(rowCount - 1, lastVisible + overscan),
  };
}

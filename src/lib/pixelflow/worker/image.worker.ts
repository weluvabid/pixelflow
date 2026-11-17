import type { PhotoRecord } from '../images.ts';

interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
}

interface DatasetMetadata {
  readonly version: number;
  readonly total: number;
  readonly chunkSize: number;
  readonly chunkCount: number;
}

const scope = globalThis as unknown as WorkerScope;
const MAX_CACHED_CHUNKS = 3;
const MAX_QUERY_SIZE = 10_000;
let initialized = false;
let datasetBaseUrl = '';
let metadata: DatasetMetadata | null = null;
const chunks = new Map<number, readonly PhotoRecord[]>();
const inFlight = new Map<number, Promise<readonly PhotoRecord[]>>();

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'omit' });

  if (!response.ok) {
    throw new Error(`Dataset request failed (${response.status}): ${url}`);
  }

  return response.json() as Promise<T>;
}

function validateMetadata(value: DatasetMetadata): void {
  if (
    value?.version !== 1 ||
    !Number.isSafeInteger(value.total) ||
    value.total < 1 ||
    !Number.isSafeInteger(value.chunkSize) ||
    value.chunkSize < 1 ||
    !Number.isSafeInteger(value.chunkCount) ||
    value.chunkCount < 1 ||
    Math.ceil(value.total / value.chunkSize) !== value.chunkCount
  ) {
    throw new Error('Image dataset metadata is invalid.');
  }
}

function validateChunk(value: unknown, expectedLength: number): readonly PhotoRecord[] {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    throw new Error('Image dataset chunk has an unexpected shape or length.');
  }

  for (const [index, record] of value.entries()) {
    if (
      typeof record?.id !== 'string' ||
      record.id.length === 0 ||
      typeof record.imageUrl !== 'string' ||
      typeof record.width !== 'number' ||
      !Number.isSafeInteger(record.width) ||
      record.width <= 0 ||
      typeof record.height !== 'number' ||
      !Number.isSafeInteger(record.height) ||
      record.height <= 0 ||
      typeof record.photographer !== 'string'
    ) {
      throw new Error(`Image dataset record ${index} is invalid.`);
    }
  }

  return value as PhotoRecord[];
}

async function loadChunk(index: number): Promise<readonly PhotoRecord[]> {
  const cached = chunks.get(index);

  if (cached) {
    chunks.delete(index);
    chunks.set(index, cached);

    return cached;
  }

  const pending = inFlight.get(index);

  if (pending) {
    return pending;
  }

  const task = (async () => {
    if (!metadata) {
      throw new Error('Image dataset metadata is unavailable.');
    }

    const url = new URL(`chunk-${String(index).padStart(3, '0')}.json`, datasetBaseUrl);
    const value = await fetchJson<unknown>(url.toString());
    const expectedLength = Math.min(
      metadata.chunkSize,
      metadata.total - index * metadata.chunkSize,
    );
    const records = validateChunk(value, expectedLength);

    chunks.set(index, records);

    while (chunks.size > MAX_CACHED_CHUNKS) {
      const oldest = chunks.keys().next().value;

      if (oldest === undefined) {
        break;
      }

      chunks.delete(oldest);
    }

    return records;
  })();

  inFlight.set(index, task);

  try {
    return await task;
  } finally {
    inFlight.delete(index);
  }
}

scope.onmessage = ({ data }: MessageEvent<unknown>) => {
  void handleMessage(data);
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function handleMessage(data: unknown): Promise<void> {
  let requestId = 0;

  try {
    if (
      !isRecord(data) ||
      typeof data.id !== 'number' ||
      !Number.isSafeInteger(data.id) ||
      data.id < 1
    ) {
      throw new Error('Malformed image worker request.');
    }

    requestId = data.id;

    if (data.type === 'INIT') {
      if (typeof data.datasetBaseUrl !== 'string' || data.datasetBaseUrl.length === 0) {
        throw new Error('Image dataset base URL is missing.');
      }

      if (initialized) {
        throw new Error('Image dataset has already been initialized.');
      }

      datasetBaseUrl = new URL(data.datasetBaseUrl).toString();
      metadata = await fetchJson<DatasetMetadata>(
        new URL('dataset.json', datasetBaseUrl).toString(),
      );

      validateMetadata(metadata);

      initialized = true;

      scope.postMessage({ id: data.id, type: 'READY', total: metadata.total });

      return;
    }

    if (data.type === 'QUERY') {
      if (
        typeof data.offset !== 'number' ||
        typeof data.limit !== 'number' ||
        !Number.isSafeInteger(data.offset) ||
        !Number.isSafeInteger(data.limit) ||
        data.offset < 0 ||
        data.limit < 1 ||
        data.limit > MAX_QUERY_SIZE
      ) {
        throw new RangeError('Image query range is invalid.');
      }

      if (!initialized || !metadata) {
        throw new Error('Image dataset has not been initialized.');
      }

      const { offset, limit } = data;

      const start = offset;

      if (start >= metadata.total) {
        scope.postMessage({
          id: data.id,
          type: 'WINDOW',
          offset: start,
          total: metadata.total,
          records: [],
        });

        return;
      }

      const count = Math.min(limit, metadata.total - start);
      const firstChunk = Math.floor(start / metadata.chunkSize);
      const lastChunk = Math.floor((start + count - 1) / metadata.chunkSize);
      const pages = await Promise.all(
        Array.from({ length: lastChunk - firstChunk + 1 }, (_, index) =>
          loadChunk(firstChunk + index),
        ),
      );

      const records: PhotoRecord[] = [];

      for (let index = start; index < start + count; index += 1) {
        const chunkIndex = Math.floor(index / metadata.chunkSize);
        const chunk = pages[chunkIndex - firstChunk];
        const localIndex = index % metadata.chunkSize;
        const record = chunk?.[localIndex];

        if (!record) {
          throw new Error(`Image dataset record ${index} is missing.`);
        }

        records.push(record);
      }

      scope.postMessage({
        id: data.id,
        type: 'WINDOW',
        offset: start,
        total: metadata.total,
        records,
      });

      return;
    }

    throw new Error(`Unsupported image worker request: ${String(data.type)}.`);
  } catch (error) {
    scope.postMessage({
      id: requestId,
      type: 'ERROR',
      message: error instanceof Error ? error.message : 'Unknown image worker failure.',
    });
  }
}

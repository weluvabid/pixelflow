import {
  IMAGE_CACHE_SIZE,
  IMAGE_DECODE_CONCURRENCY,
  IMAGE_FETCH_CONCURRENCY,
  IMAGE_FETCH_MAX_RETRIES,
  IMAGE_FETCH_TIMEOUT_MS,
  IMAGE_RETRY_BASE_DELAY_MS,
  IMAGE_RETRY_MAX_DELAY_MS,
  IMAGE_OVERSCAN_DELAY_MS,
  optimizedImageUrl,
  type PhotoRecord,
} from '../images.ts';

interface QueuedImage {
  readonly record: PhotoRecord;
  readonly priority: 0 | 1;
}

export interface ImageCacheOptions {
  readonly fetchTimeoutMs?: number;
  readonly maxRetries?: number;
  readonly retryBaseDelayMs?: number;
  readonly retryMaxDelayMs?: number;
  readonly random?: () => number;
}

interface DecodeTask {
  readonly record: PhotoRecord;
  readonly blob: Blob;
  readonly controller: AbortController;
}

class ImageRequestError extends Error {
  readonly status: number;

  constructor(photoId: string, status: number) {
    super(`Image ${photoId} failed: HTTP ${status}.`);

    this.name = 'ImageRequestError';
    this.status = status;
  }
}

export class ImageCache {
  readonly #bitmaps = new Map<string, ImageBitmap>();
  readonly #requests = new Map<string, AbortController>();
  readonly #queued = new Map<string, QueuedImage>();
  readonly #decodeQueue: DecodeTask[] = [];
  readonly #decoding = new Set<string>();
  readonly #failed = new Set<string>();
  readonly #retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #retryCounts = new Map<string, number>();
  readonly #options: Required<ImageCacheOptions>;
  #activeFetches = 0;
  #activeDecodes = 0;
  #destroyed = false;
  #overscanTimer: ReturnType<typeof setTimeout> | undefined;
  #viewportKey = '';
  #desiredIds = new Set<string>();
  #visibleIds = new Set<string>();
  #overscanRecords: readonly PhotoRecord[] = [];
  readonly #onChange: (photoId: string) => void;
  readonly #onError: (error: Error) => void;

  constructor(
    onChange: (photoId: string) => void,
    onError: (error: Error) => void,
    options: ImageCacheOptions = {},
  ) {
    this.#onChange = onChange;
    this.#onError = onError;
    this.#options = {
      fetchTimeoutMs: options.fetchTimeoutMs ?? IMAGE_FETCH_TIMEOUT_MS,
      maxRetries: options.maxRetries ?? IMAGE_FETCH_MAX_RETRIES,
      retryBaseDelayMs: options.retryBaseDelayMs ?? IMAGE_RETRY_BASE_DELAY_MS,
      retryMaxDelayMs: options.retryMaxDelayMs ?? IMAGE_RETRY_MAX_DELAY_MS,
      random: options.random ?? Math.random,
    };
  }

  get size(): number {
    return this.#bitmaps.size;
  }

  get(photoId: string): ImageBitmap | undefined {
    const bitmap = this.#bitmaps.get(photoId);

    if (bitmap) {
      this.#bitmaps.delete(photoId);
      this.#bitmaps.set(photoId, bitmap);
    }

    return bitmap;
  }

  /**
   * Replace the desired image set for the current viewport. Visible images are
   * fetched immediately; overscan is scheduled only after scrolling settles.
   */
  updateViewport(
    visibleRecords: readonly PhotoRecord[],
    overscanRecords: readonly PhotoRecord[],
  ): void {
    if (this.#destroyed) {
      return;
    }

    const visibleIds = new Set(visibleRecords.map(({ id }) => id));
    const viewportKey = [...visibleIds].join('\u0000');
    const viewportChanged = viewportKey !== this.#viewportKey;

    this.#overscanRecords = overscanRecords;
    this.#visibleIds = visibleIds;

    if (viewportChanged) {
      this.#desiredIds = new Set(visibleIds);

      for (const [id, controller] of this.#requests) {
        if (!visibleIds.has(id)) {
          controller.abort();
        }
      }

      for (const [id, timer] of this.#retryTimers) {
        if (!visibleIds.has(id)) {
          clearTimeout(timer);
          this.#retryTimers.delete(id);
          this.#retryCounts.delete(id);
        }
      }

      // Remove stale queued work and blobs waiting for decode.
      for (const id of this.#queued.keys()) {
        if (!visibleIds.has(id)) {
          this.#queued.delete(id);
        }
      }

      for (let index = this.#decodeQueue.length - 1; index >= 0; index -= 1) {
        const task = this.#decodeQueue[index];

        if (task && !visibleIds.has(task.record.id)) {
          task.controller.abort();
          this.#decoding.delete(task.record.id);
          this.#decodeQueue.splice(index, 1);
        }
      }
    }

    for (const record of visibleRecords) {
      this.#desiredIds.add(record.id);
      this.#enqueue(record, 0);
    }

    this.#drainFetches();

    if (viewportChanged) {
      if (this.#overscanTimer) {
        clearTimeout(this.#overscanTimer);
      }

      this.#overscanTimer = setTimeout(() => {
        this.#overscanTimer = undefined;

        if (this.#destroyed) {
          return;
        }

        for (const record of this.#overscanRecords) {
          if (!this.#desiredIds.has(record.id)) {
            this.#desiredIds.add(record.id);
            this.#enqueue(record, 1);
          }
        }

        this.#drainFetches();
      }, IMAGE_OVERSCAN_DELAY_MS);
      this.#viewportKey = viewportKey;
    }
  }

  destroy(): void {
    this.#destroyed = true;

    if (this.#overscanTimer) {
      clearTimeout(this.#overscanTimer);
    }

    this.#overscanTimer = undefined;

    for (const controller of this.#requests.values()) {
      controller.abort();
    }

    this.#requests.clear();
    this.#queued.clear();

    for (const timer of this.#retryTimers.values()) {
      clearTimeout(timer);
    }

    this.#retryTimers.clear();
    this.#retryCounts.clear();

    for (const task of this.#decodeQueue) {
      task.controller.abort();
    }

    this.#decodeQueue.length = 0;

    this.#decoding.clear();

    for (const bitmap of this.#bitmaps.values()) {
      bitmap.close();
    }

    this.#bitmaps.clear();
  }

  #enqueue(record: PhotoRecord, priority: 0 | 1): void {
    if (
      this.#destroyed ||
      this.#bitmaps.has(record.id) ||
      this.#failed.has(record.id) ||
      this.#requests.has(record.id) ||
      this.#retryTimers.has(record.id) ||
      this.#decoding.has(record.id)
    ) {
      return;
    }

    const existing = this.#queued.get(record.id);

    if (!existing || priority < existing.priority) {
      this.#queued.set(record.id, { record, priority });
    }
  }

  #drainFetches(): void {
    while (
      !this.#destroyed &&
      this.#activeFetches < IMAGE_FETCH_CONCURRENCY &&
      this.#queued.size > 0
    ) {
      let nextId: string | undefined;
      let next: QueuedImage | undefined;

      for (const [id, queued] of this.#queued) {
        if (!next || queued.priority < next.priority) {
          nextId = id;
          next = queued;

          if (queued.priority === 0) {
            break;
          }
        }
      }

      if (!nextId || !next) {
        throw new Error('Image request queue became inconsistent.');
      }

      this.#queued.delete(nextId);
      const controller = new AbortController();

      this.#requests.set(next.record.id, controller);

      this.#activeFetches += 1;

      void this.#fetch(next.record, controller).finally(() => {
        this.#activeFetches -= 1;

        if (this.#requests.get(next.record.id) === controller) {
          this.#requests.delete(next.record.id);
        }

        if (
          this.#desiredIds.has(next.record.id) &&
          !this.#bitmaps.has(next.record.id) &&
          !this.#failed.has(next.record.id) &&
          !this.#retryTimers.has(next.record.id) &&
          !this.#decoding.has(next.record.id)
        ) {
          this.#enqueue(next.record, this.#visibleIds.has(next.record.id) ? 0 : 1);
        }

        this.#drainFetches();
      });
    }
  }

  async #fetch(record: PhotoRecord, controller: AbortController): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new DOMException(`Image ${record.id} request timed out.`, 'TimeoutError'));
          controller.abort();
        }, this.#options.fetchTimeoutMs);
      });
      const responsePromise = (async () => {
        const response = await fetch(optimizedImageUrl(record.imageUrl), {
          mode: 'cors',
          credentials: 'omit',
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new ImageRequestError(record.id, response.status);
        }

        return response.blob();
      })();
      const blob = await Promise.race([responsePromise, timeoutPromise]);

      if (controller.signal.aborted || this.#destroyed || !this.#desiredIds.has(record.id)) {
        return;
      }

      this.#retryCounts.delete(record.id);
      this.#decodeQueue.push({ record, blob, controller });
      this.#decoding.add(record.id);
      this.#drainDecodes();
    } catch (error) {
      if (
        controller.signal.aborted &&
        !(error instanceof DOMException && error.name === 'TimeoutError')
      ) {
        return;
      }

      if (this.#destroyed || !this.#desiredIds.has(record.id)) {
        return;
      }

      if (this.#isRetryable(error)) {
        this.#scheduleRetry(
          record,
          error instanceof Error ? error : new Error('Image request failed.'),
        );

        return;
      }

      this.#failed.add(record.id);
      this.#onError(
        error instanceof Error ? error : new Error(`Image ${record.id} failed to load.`),
      );
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  #isRetryable(error: unknown): boolean {
    if (error instanceof ImageRequestError) {
      return error.status === 408 || error.status === 429 || error.status >= 500;
    }

    return (
      error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError')
    );
  }

  #scheduleRetry(record: PhotoRecord, error: Error): void {
    const retries = this.#retryCounts.get(record.id) ?? 0;

    if (retries >= this.#options.maxRetries) {
      this.#failed.add(record.id);
      this.#onError(error);

      return;
    }

    const nextRetry = retries + 1;

    this.#retryCounts.set(record.id, nextRetry);

    const exponentialDelay = Math.min(
      this.#options.retryMaxDelayMs,
      this.#options.retryBaseDelayMs * 2 ** (nextRetry - 1),
    );
    const jitteredDelay = Math.round(exponentialDelay * (0.5 + this.#options.random() * 0.5));
    const timer = setTimeout(() => {
      this.#retryTimers.delete(record.id);

      if (
        this.#destroyed ||
        !this.#desiredIds.has(record.id) ||
        this.#bitmaps.has(record.id) ||
        this.#requests.has(record.id)
      ) {
        return;
      }

      this.#enqueue(record, this.#visibleIds.has(record.id) ? 0 : 1);
      this.#drainFetches();
    }, jitteredDelay);

    this.#retryTimers.set(record.id, timer);
  }

  #drainDecodes(): void {
    while (
      !this.#destroyed &&
      this.#activeDecodes < IMAGE_DECODE_CONCURRENCY &&
      this.#decodeQueue.length > 0
    ) {
      const task = this.#decodeQueue.shift();

      if (!task) {
        throw new Error('Image decode queue became inconsistent.');
      }

      this.#activeDecodes += 1;

      void createImageBitmap(task.blob)
        .then((bitmap) => {
          if (
            this.#destroyed ||
            task.controller.signal.aborted ||
            !this.#desiredIds.has(task.record.id)
          ) {
            bitmap.close();

            return;
          }

          this.#bitmaps.set(task.record.id, bitmap);

          while (this.#bitmaps.size > IMAGE_CACHE_SIZE) {
            const oldest = this.#bitmaps.keys().next().value;

            if (oldest === undefined) {
              break;
            }

            this.#bitmaps.get(oldest)?.close();
            this.#bitmaps.delete(oldest);
          }

          this.#onChange(task.record.id);
        })
        .catch((error: unknown) => {
          if (task.controller.signal.aborted || this.#destroyed) {
            return;
          }

          this.#failed.add(task.record.id);
          this.#onError(
            error instanceof Error ? error : new Error(`Image ${task.record.id} failed to decode.`),
          );
        })
        .finally(() => {
          this.#decoding.delete(task.record.id);

          this.#activeDecodes -= 1;

          if (
            !this.#destroyed &&
            this.#desiredIds.has(task.record.id) &&
            !this.#bitmaps.has(task.record.id) &&
            !this.#failed.has(task.record.id) &&
            !this.#requests.has(task.record.id)
          ) {
            this.#enqueue(task.record, this.#visibleIds.has(task.record.id) ? 0 : 1);
            this.#drainFetches();
          }

          this.#drainDecodes();
        });
    }
  }
}

import {
  IMAGE_CACHE_SIZE,
  IMAGE_LOAD_CONCURRENCY,
  IMAGE_QUEUE_LIMIT,
  optimizedImageUrl,
  type PhotoRecord,
} from '../images.ts';

export class ImageCache {
  readonly #bitmaps = new Map<string, ImageBitmap>();
  readonly #inFlight = new Set<string>();
  readonly #queue: PhotoRecord[] = [];
  readonly #queued = new Set<string>();
  readonly #failed = new Set<string>();
  #active = 0;
  #destroyed = false;
  readonly #onChange: () => void;
  readonly #onError: (error: Error) => void;

  constructor(onChange: () => void, onError: (error: Error) => void) {
    this.#onChange = onChange;
    this.#onError = onError;
  }

  get(photoId: string): ImageBitmap | undefined {
    const bitmap = this.#bitmaps.get(photoId);
    if (bitmap) {
      this.#bitmaps.delete(photoId);
      this.#bitmaps.set(photoId, bitmap);
    }
    return bitmap;
  }

  request(record: PhotoRecord): void {
    const { id } = record;
    if (
      this.#destroyed || this.#bitmaps.has(id) || this.#failed.has(id) ||
      this.#inFlight.has(id) || this.#queued.has(id)
    ) return;

    // A fast fling can move the viewport faster than images decode. Keep
    // queued work bounded and let a later visible frame enqueue dropped items.
    if (this.#queue.length >= IMAGE_QUEUE_LIMIT) {
      const stale = this.#queue.shift();
      if (stale) this.#queued.delete(stale.id);
    }
    this.#queue.push(record);
    this.#queued.add(id);
    this.#drain();
  }

  destroy(): void {
    this.#destroyed = true;
    this.#queue.length = 0;
    this.#queued.clear();
    for (const bitmap of this.#bitmaps.values()) bitmap.close();
    this.#bitmaps.clear();
  }

  #drain(): void {
    while (!this.#destroyed && this.#active < IMAGE_LOAD_CONCURRENCY && this.#queue.length) {
      const record = this.#queue.shift();
      if (!record) throw new Error('Image loading queue became inconsistent.');
      this.#queued.delete(record.id);
      this.#active += 1;
      this.#inFlight.add(record.id);
      void this.#load(record).finally(() => {
        this.#active -= 1;
        this.#inFlight.delete(record.id);
        this.#drain();
      });
    }
  }

  async #load(record: PhotoRecord): Promise<void> {
    try {
      const response = await fetch(optimizedImageUrl(record.imageUrl), {
        mode: 'cors',
        credentials: 'omit',
      });
      if (!response.ok) throw new Error(`Image ${record.id} failed: HTTP ${response.status}.`);
      const bitmap = await createImageBitmap(await response.blob());
      if (this.#destroyed) {
        bitmap.close();
        return;
      }

      this.#bitmaps.set(record.id, bitmap);
      while (this.#bitmaps.size > IMAGE_CACHE_SIZE) {
        const oldest = this.#bitmaps.keys().next().value;
        if (oldest === undefined) break;
        this.#bitmaps.get(oldest)?.close();
        this.#bitmaps.delete(oldest);
      }
      this.#onChange();
    } catch (error) {
      this.#failed.add(record.id);
      this.#onError(error instanceof Error ? error : new Error(`Image ${record.id} failed to load.`));
    }
  }
}

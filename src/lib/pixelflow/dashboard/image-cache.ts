import { imageUrl } from '../images.ts';
const MAX_DECODED_IMAGES = 48; const MAX_CONCURRENT_LOADS = 4;
export class ImageCache {
  readonly #bitmaps = new Map<number, ImageBitmap>(); readonly #inFlight = new Set<number>(); readonly #queue: number[] = []; readonly #failed = new Set<number>();
  #active = 0; #destroyed = false; readonly #onChange: () => void; readonly #onError: (error: Error) => void;
  constructor(onChange: () => void, onError: (error: Error) => void) { this.#onChange = onChange; this.#onError = onError; }
  get(assetId: number): ImageBitmap | undefined { const bitmap = this.#bitmaps.get(assetId); if (bitmap) { this.#bitmaps.delete(assetId); this.#bitmaps.set(assetId, bitmap); } return bitmap; }
  request(assetId: number): void { if (this.#destroyed || this.#bitmaps.has(assetId) || this.#failed.has(assetId) || this.#inFlight.has(assetId) || this.#queue.includes(assetId)) return; this.#queue.push(assetId); this.#drain(); }
  destroy(): void { this.#destroyed = true; this.#queue.length = 0; for (const bitmap of this.#bitmaps.values()) bitmap.close(); this.#bitmaps.clear(); }
  #drain(): void {
    while (!this.#destroyed && this.#active < MAX_CONCURRENT_LOADS && this.#queue.length) {
      const assetId = this.#queue.shift()!; this.#active += 1; this.#inFlight.add(assetId);
      void this.#load(assetId).finally(() => { this.#active -= 1; this.#inFlight.delete(assetId); this.#drain(); });
    }
  }
  async #load(assetId: number): Promise<void> {
    try {
      const response = await fetch(imageUrl(assetId), { mode: 'cors', credentials: 'omit' });
      if (!response.ok) throw new Error(`Image ${assetId} failed: HTTP ${response.status}.`);
      const bitmap = await createImageBitmap(await response.blob());
      if (this.#destroyed) { bitmap.close(); return; }
      this.#bitmaps.set(assetId, bitmap);
      while (this.#bitmaps.size > MAX_DECODED_IMAGES) { const oldest = this.#bitmaps.keys().next().value; if (oldest === undefined) break; this.#bitmaps.get(oldest)?.close(); this.#bitmaps.delete(oldest); }
      this.#onChange();
    } catch (error) { this.#failed.add(assetId); this.#onError(error instanceof Error ? error : new Error(`Image ${assetId} failed to load.`)); }
  }
}

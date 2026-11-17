import { ImageCache } from './image-cache.ts';
import { IMAGE_ROW_HEIGHT, IMAGE_TILE_SIZE } from '../images.ts';

const MAX_DPR = 2;
const INSET = 12;
const GAP = 14;

export interface CanvasImageRendererOptions {
  readonly getCanvas: () => HTMLCanvasElement | null;
  readonly getScroller: () => HTMLElement | null;
  readonly getScrollTop: () => number;
  readonly getViewportHeight: () => number;
  readonly getAssetIds: () => Uint16Array;
  readonly getWindowOffset: () => number;
  readonly getTotal: () => number;
  readonly getColumns: () => number;
  readonly onMetrics: (metrics: { renderMs: number; visibleImages: number }) => void;
  readonly onImageError: (error: Error) => void;
}

export class CanvasImageRenderer {
  readonly #options: CanvasImageRendererOptions;
  readonly #cache: ImageCache;
  #frame = 0;
  #destroyed = false;

  constructor(options: CanvasImageRendererOptions) {
    this.#options = options;
    this.#cache = new ImageCache(() => this.schedule(), options.onImageError);
  }

  schedule(): void {
    if (this.#destroyed || this.#frame || !this.#options.getCanvas()) return;
    this.#frame = requestAnimationFrame(() => { this.#frame = 0; this.draw(); });
  }

  destroy(): void {
    this.#destroyed = true;
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#cache.destroy();
  }

  draw(): void {
    const started = performance.now();
    const canvas = this.#options.getCanvas();
    const scroller = this.#options.getScroller();
    if (!canvas || !scroller) return;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, this.#options.getViewportHeight());
    canvas.style.height = `${height}px`;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const backingWidth = Math.round(width * dpr);
    const backingHeight = Math.round(height * dpr);
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) { canvas.width = backingWidth; canvas.height = backingHeight; }
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas 2D context is unavailable.');
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const styles = getComputedStyle(canvas);
    context.fillStyle = styles.getPropertyValue('--color-background').trim() || '#fff';
    context.fillRect(0, 0, width, height);

    const total = this.#options.getTotal();
    const scrollTop = this.#options.getScrollTop();
    const columns = this.#options.getColumns();
    const firstRow = Math.max(0, Math.floor(scrollTop / IMAGE_ROW_HEIGHT) - 3);
    const lastRow = Math.min(Math.ceil(total / columns) - 1, Math.ceil((scrollTop + height) / IMAGE_ROW_HEIGHT) + 2);
    const cardWidth = (width - INSET * 2 - GAP * (columns - 1)) / columns;
    const assetIds = this.#options.getAssetIds();
    const offset = this.#options.getWindowOffset();
    let visibleImages = 0;

    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        if (index >= total) break;
        const localIndex = index - offset;
        if (localIndex < 0 || localIndex >= assetIds.length) continue;
        const assetId = assetIds[localIndex];
        const x = INSET + column * (cardWidth + GAP);
        const y = row * IMAGE_ROW_HEIGHT - scrollTop + (IMAGE_ROW_HEIGHT - IMAGE_TILE_SIZE) / 2;
        const bitmap = this.#cache.get(assetId);
        context.fillStyle = styles.getPropertyValue('--color-muted').trim() || '#eee';
        context.fillRect(x, y, cardWidth, IMAGE_TILE_SIZE);
        if (bitmap) {
          context.save();
          context.beginPath(); context.roundRect(x, y, cardWidth, IMAGE_TILE_SIZE, 8); context.clip();
          context.drawImage(bitmap, x, y, cardWidth, IMAGE_TILE_SIZE);
          context.restore();
        } else {
          this.#cache.request(assetId);
        }
        visibleImages += 1;
      }
    }
    this.#options.onMetrics({ renderMs: performance.now() - started, visibleImages });
  }
}

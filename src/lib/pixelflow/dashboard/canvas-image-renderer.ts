import { ImageCache } from './image-cache.ts';
import {
  IMAGE_FADE_DURATION_MS,
  IMAGE_ROW_HEIGHT,
  IMAGE_TILE_SIZE,
  type PhotoRecord,
} from '../images.ts';

const MAX_DPR = 2;
const INSET = 12;
const GAP = 14;

export interface CanvasImageRendererOptions {
  readonly getCanvas: () => HTMLCanvasElement | null;
  readonly getScroller: () => HTMLElement | null;
  readonly getScrollTop: () => number;
  readonly getViewportHeight: () => number;
  readonly getRecords: () => readonly PhotoRecord[];
  readonly getWindowOffset: () => number;
  readonly getTotal: () => number;
  readonly getColumns: () => number;
  readonly onMetrics: (metrics: { renderMs: number; loadedImages: number }) => void;
  readonly onImageError: (error: Error) => void;
}

export class CanvasImageRenderer {
  readonly #options: CanvasImageRendererOptions;
  readonly #cache: ImageCache;
  #frame = 0;
  #destroyed = false;
  readonly #fadeStartedAt = new Map<string, number>();

  constructor(options: CanvasImageRendererOptions) {
    this.#options = options;
    this.#cache = new ImageCache((photoId) => {
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.#fadeStartedAt.set(photoId, performance.now());

        while (this.#fadeStartedAt.size > 48) {
          const oldest = this.#fadeStartedAt.keys().next().value;

          if (oldest === undefined) {
            break;
          }

          this.#fadeStartedAt.delete(oldest);
        }
      }

      this.schedule();
    }, options.onImageError);
  }

  schedule(): void {
    if (this.#destroyed || this.#frame || !this.#options.getCanvas()) {
      return;
    }

    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;

      this.draw();
    });
  }

  destroy(): void {
    this.#destroyed = true;

    if (this.#frame) {
      cancelAnimationFrame(this.#frame);
    }

    this.#frame = 0;

    this.#cache.destroy();
    this.#fadeStartedAt.clear();
  }

  draw(): void {
    const started = performance.now();
    const canvas = this.#options.getCanvas();
    const scroller = this.#options.getScroller();

    if (!canvas || !scroller) {
      return;
    }

    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, this.#options.getViewportHeight());

    canvas.style.height = `${height}px`;

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const backingWidth = Math.round(width * dpr);
    const backingHeight = Math.round(height * dpr);

    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }

    const context = canvas.getContext('2d', { alpha: false });

    if (!context) {
      throw new Error('Canvas 2D context is unavailable.');
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const styles = getComputedStyle(canvas);
    const background = styles.getPropertyValue('--color-background').trim() || '#fff';
    const muted = styles.getPropertyValue('--color-muted').trim() || '#eee';
    const cardSurface = styles.getPropertyValue('--color-card').trim() || background;

    context.fillStyle = background;

    context.fillRect(0, 0, width, height);

    const total = this.#options.getTotal();
    const scrollTop = this.#options.getScrollTop();
    const columns = this.#options.getColumns();
    const firstRow = Math.max(0, Math.floor(scrollTop / IMAGE_ROW_HEIGHT) - 3);
    const lastRow = Math.min(
      Math.ceil(total / columns) - 1,
      Math.ceil((scrollTop + height) / IMAGE_ROW_HEIGHT) + 2,
    );
    const cardWidth = (width - INSET * 2 - GAP * (columns - 1)) / columns;
    const records = this.#options.getRecords();
    const offset = this.#options.getWindowOffset();

    const firstVisibleRow = Math.max(0, Math.floor(scrollTop / IMAGE_ROW_HEIGHT));
    const lastVisibleRow = Math.min(
      Math.ceil(total / columns) - 1,
      Math.ceil((scrollTop + height) / IMAGE_ROW_HEIGHT) - 1,
    );
    const visibleRecords: PhotoRecord[] = [];
    const overscanRecords: PhotoRecord[] = [];
    const firstWantedRow = Math.max(0, firstVisibleRow - 1);
    const lastWantedRow = Math.min(Math.ceil(total / columns) - 1, lastVisibleRow + 1);

    for (let row = firstWantedRow; row <= lastWantedRow; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;

        if (index >= total) {
          break;
        }

        const localIndex = index - offset;
        const record = records[localIndex];

        if (!record) {
          continue;
        }

        if (row >= firstVisibleRow && row <= lastVisibleRow) {
          visibleRecords.push(record);
        } else {
          overscanRecords.push(record);
        }
      }
    }

    this.#cache.updateViewport(visibleRecords, overscanRecords);

    let hasActiveFades = false;
    const fadeNow = performance.now();

    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;

        if (index >= total) {
          break;
        }

        const localIndex = index - offset;

        if (localIndex < 0 || localIndex >= records.length) {
          continue;
        }

        const record = records[localIndex];

        if (!record) {
          throw new Error(`Missing image record at viewport index ${index}.`);
        }

        const x = INSET + column * (cardWidth + GAP);
        const y = row * IMAGE_ROW_HEIGHT - scrollTop + (IMAGE_ROW_HEIGHT - IMAGE_TILE_SIZE) / 2;
        const bitmap = this.#cache.get(record.id);

        if (!bitmap) {
          const skeleton = context.createLinearGradient(x, y, x + cardWidth, y + IMAGE_TILE_SIZE);

          skeleton.addColorStop(0, muted);
          skeleton.addColorStop(0.52, cardSurface);
          skeleton.addColorStop(1, muted);

          context.fillStyle = skeleton;

          context.beginPath();
          context.roundRect(x, y, cardWidth, IMAGE_TILE_SIZE, 8);
          context.fill();
        } else {
          context.save();
          context.beginPath();
          context.roundRect(x, y, cardWidth, IMAGE_TILE_SIZE, 8);
          context.clip();
          const sourceRatio = bitmap.width / bitmap.height;
          const targetRatio = cardWidth / IMAGE_TILE_SIZE;
          let sourceX = 0;
          let sourceY = 0;
          let sourceWidth = bitmap.width;
          let sourceHeight = bitmap.height;

          if (sourceRatio > targetRatio) {
            sourceWidth = bitmap.height * targetRatio;
            sourceX = (bitmap.width - sourceWidth) / 2;
          } else if (sourceRatio < targetRatio) {
            sourceHeight = bitmap.width / targetRatio;
            sourceY = (bitmap.height - sourceHeight) / 2;
          }

          const fadeStartedAt = this.#fadeStartedAt.get(record.id);

          if (fadeStartedAt !== undefined) {
            const progress = Math.min(1, (fadeNow - fadeStartedAt) / IMAGE_FADE_DURATION_MS);

            context.globalAlpha = progress;

            if (progress < 1) {
              hasActiveFades = true;
            } else {
              this.#fadeStartedAt.delete(record.id);
            }
          }

          context.drawImage(
            bitmap,
            sourceX,
            sourceY,
            sourceWidth,
            sourceHeight,
            x,
            y,
            cardWidth,
            IMAGE_TILE_SIZE,
          );
          context.restore();

          context.globalAlpha = 1;
        }
      }
    }

    this.#options.onMetrics({
      renderMs: performance.now() - started,
      loadedImages: this.#cache.size,
    });

    if (hasActiveFades) {
      this.schedule();
    }
  }
}

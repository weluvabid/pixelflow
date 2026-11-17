import type { TimerRecord } from '../simulation/timer-matrix.ts';
import { formatDuration } from './timer-format.ts';
import {
  timerId,
  timerName,
  timerStatus,
  MATRIX_CELL_GAP,
  MATRIX_CELL_HEIGHT,
  MATRIX_ROW_HEIGHT,
  type MatrixRowRange,
} from './matrix-model.ts';

const MAX_CANVAS_DPR = 2;
const HORIZONTAL_INSET = 12;
const VERTICAL_INSET = (MATRIX_ROW_HEIGHT - MATRIX_CELL_HEIGHT) / 2;

interface CanvasPalette {
  readonly foreground: string;
  readonly muted: string;
  readonly border: string;
  readonly accent: string;
  readonly card: string;
  readonly selectedCard: string;
  readonly hoverCard: string;
  readonly running: string;
  readonly paused: string;
  readonly degraded: string;
}

export interface CanvasMatrixRendererOptions {
  readonly getCanvas: () => HTMLCanvasElement | null;
  readonly getScroller: () => HTMLElement | null;
  readonly getScrollTop: () => number;
  readonly getViewportHeight: () => number;
  readonly getRows: () => MatrixRowRange;
  readonly getRecords: () => readonly TimerRecord[];
  readonly getWindowOffset: () => number;
  readonly getTimerCount: () => number;
  readonly getColumns: () => number;
  readonly getSelectedHandle: () => number | null;
  readonly getHoveredHandle: () => number | null;
  readonly onMetrics: (metrics: { renderMs: number; visibleTimers: number }) => void;
}

export class CanvasMatrixRenderer {
  readonly #options: CanvasMatrixRendererOptions;
  #frame = 0;
  #palette: CanvasPalette | null = null;
  #contextCanvas: HTMLCanvasElement | null = null;
  #context: CanvasRenderingContext2D | null = null;

  constructor(options: CanvasMatrixRendererOptions) {
    this.#options = options;
  }

  schedule(): void {
    if (this.#frame !== 0 || this.#options.getCanvas() === null) {
      return;
    }

    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;

      this.draw();
    });
  }

  cancel(): void {
    if (this.#frame === 0) {
      return;
    }

    cancelAnimationFrame(this.#frame);

    this.#frame = 0;
  }

  drawNow(): void {
    this.cancel();
    this.draw();
  }

  invalidateTheme(): void {
    this.#palette = null;

    this.drawNow();
  }

  destroy(): void {
    this.cancel();

    this.#context = null;
    this.#contextCanvas = null;
    this.#palette = null;
  }

  hitTest(clientX: number, clientY: number): number | null {
    const canvas = this.#options.getCanvas();
    const scroller = this.#options.getScroller();

    if (canvas === null || scroller === null) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const width = Math.max(1, canvas.clientWidth);
    const columns = this.#options.getColumns();
    const cardWidth = (width - HORIZONTAL_INSET * 2 - MATRIX_CELL_GAP * (columns - 1)) / columns;
    const contentY = y + this.#options.getScrollTop();
    const row = Math.floor(contentY / MATRIX_ROW_HEIGHT);
    const rowY = row * MATRIX_ROW_HEIGHT + VERTICAL_INSET;

    if (contentY < rowY || contentY > rowY + MATRIX_CELL_HEIGHT) {
      return null;
    }

    const column = Math.floor((x - HORIZONTAL_INSET) / (cardWidth + MATRIX_CELL_GAP));

    if (column < 0 || column >= columns) {
      return null;
    }

    const withinCardX = x - HORIZONTAL_INSET - column * (cardWidth + MATRIX_CELL_GAP);

    if (withinCardX < 0 || withinCardX > cardWidth) {
      return null;
    }

    const handle = row * columns + column;

    return handle < this.#options.getTimerCount() ? handle : null;
  }

  draw(): void {
    const started = performance.now();
    const canvas = this.#options.getCanvas();
    const scroller = this.#options.getScroller();
    const timerCount = this.#options.getTimerCount();
    const columns = this.#options.getColumns();

    if (canvas === null || scroller === null || timerCount <= 0) {
      return;
    }

    if (!Number.isSafeInteger(columns) || columns < 1) {
      throw new RangeError(`Invalid matrix column count: ${columns}.`);
    }

    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, this.#options.getViewportHeight());

    canvas.style.height = `${height}px`;
    canvas.style.marginBottom = `${-height}px`;

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_CANVAS_DPR);
    const backingWidth = Math.round(width * dpr);
    const backingHeight = Math.round(height * dpr);

    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }

    if (this.#contextCanvas !== canvas || this.#context === null) {
      this.#contextCanvas = canvas;
      this.#context = canvas.getContext('2d', { alpha: true });
    }

    const context = this.#context;

    if (context === null) {
      throw new Error('Canvas 2D context is unavailable.');
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    const palette = this.#getPalette(canvas);
    const { foreground, muted, border, accent, card, selectedCard, hoverCard } = palette;
    const cardWidth = Math.max(
      1,
      (width - HORIZONTAL_INSET * 2 - MATRIX_CELL_GAP * (columns - 1)) / columns,
    );
    const scrollTop = this.#options.getScrollTop();
    const rows = this.#options.getRows();
    const records = this.#options.getRecords();
    const windowOffset = this.#options.getWindowOffset();
    const now = performance.timeOrigin + performance.now();
    const selected = this.#options.getSelectedHandle();
    const hovered = this.#options.getHoveredHandle();
    let visibleTimers = 0;

    context.textBaseline = 'alphabetic';
    context.lineJoin = 'round';

    for (let rowIndex = rows.first; rowIndex <= rows.last; rowIndex += 1) {
      const rowY = rowIndex * MATRIX_ROW_HEIGHT - scrollTop + VERTICAL_INSET;

      if (rowY + MATRIX_CELL_HEIGHT < 0 || rowY > height) {
        continue;
      }

      const firstHandle = rowIndex * columns;
      const firstRecordIndex = firstHandle - windowOffset;

      for (let column = 0; column < columns; column += 1) {
        const handle = firstHandle + column;

        if (handle >= timerCount) {
          break;
        }

        const recordIndex = firstRecordIndex + column;

        if (recordIndex < 0 || recordIndex >= records.length) {
          continue;
        }

        const record = records[recordIndex];

        if (record === undefined) {
          continue;
        }

        if (record.handle !== handle) {
          throw new Error(
            `Timer window is misaligned: expected handle ${handle}, received ${record.handle}.`,
          );
        }

        visibleTimers += 1;

        const x = HORIZONTAL_INSET + column * (cardWidth + MATRIX_CELL_GAP);
        const elapsed = Math.max(0, now - record.startedAt);
        const isSelected = selected === handle;
        const isHovered = hovered === handle;

        context.fillStyle = isSelected ? selectedCard : isHovered ? hoverCard : card;
        context.strokeStyle = isSelected ? accent : isHovered ? foreground : border;
        context.lineWidth = isSelected ? 2 : isHovered ? 1.25 : 1;

        context.beginPath();
        context.roundRect(x, rowY, cardWidth, MATRIX_CELL_HEIGHT, 10);
        context.fill();
        context.stroke();

        context.fillStyle = muted;
        context.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';

        context.fillText(timerId(record.handle), x + 14, rowY + 25);

        context.fillStyle = foreground;
        context.font = '600 13px ui-sans-serif, system-ui, sans-serif';

        context.fillText(timerName(record.handle), x + 14, rowY + 54, cardWidth - 28);

        context.fillStyle = foreground;
        context.font = '600 27px ui-monospace, SFMono-Regular, Menlo, monospace';

        context.fillText(formatDuration(elapsed), x + 14, rowY + 105);

        context.fillStyle = muted;
        context.font = '500 9px ui-sans-serif, system-ui, sans-serif';
        context.letterSpacing = '1.2px';

        context.fillText('ELAPSED TIME', x + 14, rowY + 126);

        context.letterSpacing = '0px';

        const state = timerStatus(record.handle);
        const statusColor =
          state === 'running'
            ? palette.running
            : state === 'paused'
              ? palette.paused
              : palette.degraded;

        context.fillStyle = statusColor;

        context.beginPath();
        context.arc(x + 18, rowY + 145, 3.5, 0, Math.PI * 2);
        context.fill();

        context.fillStyle = muted;
        context.font = '500 10px ui-sans-serif, system-ui, sans-serif';

        context.fillText(state.toUpperCase(), x + 28, rowY + 149);
      }
    }

    this.#options.onMetrics({ renderMs: performance.now() - started, visibleTimers });
  }
  #getPalette(canvas: HTMLCanvasElement): CanvasPalette {
    if (this.#palette !== null) {
      return this.#palette;
    }

    const styles = getComputedStyle(canvas);
    const read = (name: string, fallback: string): string =>
      styles.getPropertyValue(name).trim() || fallback;
    const foreground = read('--color-card-foreground', read('--color-foreground', '#20201e'));
    const card = read('--color-card', '#ffffff');
    const selectedCard = read('--color-accent', card);

    this.#palette = {
      foreground,
      muted: read('--color-muted-foreground', '#6f6d67'),
      border: read('--color-border', '#e8e7e1'),
      accent: read('--color-primary', foreground),
      card,
      selectedCard,
      hoverCard: read('--color-muted', selectedCard),
      running: read('--color-success', '#16a34a'),
      paused: read('--color-warning', '#d97706'),
      degraded: read('--color-destructive', '#dc2626'),
    };

    return this.#palette;
  }
}

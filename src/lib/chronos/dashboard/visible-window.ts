export interface VisibleRange {
  readonly first: number;
  readonly last: number;
}

export interface WindowPage<T> {
  readonly offset: number;
  readonly total: number;
  readonly records: readonly T[];
}

export interface VisibleWindowControllerOptions<T> {
  readonly query: (offset: number, limit: number) => Promise<WindowPage<T>>;
  readonly getRange: () => VisibleRange;
  readonly hasCachedRange: (range: VisibleRange) => boolean;
  readonly getExpectedTotal: () => number | null;
  readonly onPage: (page: WindowPage<T>) => void;
  readonly onError: (error: unknown) => void;
  readonly maxLimit?: number;
}

function coversRange<T>(page: WindowPage<T> | null, range: VisibleRange): boolean {
  return (
    page !== null &&
    page.records.length > 0 &&
    range.first >= page.offset &&
    range.last < page.offset + page.records.length
  );
}

/** Coalesces rapid viewport range changes into bounded worker queries. */
export class VisibleWindowController<T> {
  readonly #options: VisibleWindowControllerOptions<T>;
  readonly #maxLimit: number;
  #desiredRange: VisibleRange = { first: 0, last: 0 };
  #running = false;
  #pending = false;
  #drainPromise: Promise<void> | null = null;
  #closed = false;

  constructor(options: VisibleWindowControllerOptions<T>) {
    this.#options = options;
    this.#maxLimit = options.maxLimit ?? 10_000;

    if (!Number.isSafeInteger(this.#maxLimit) || this.#maxLimit < 1 || this.#maxLimit > 10_000) {
      throw new RangeError('Maximum window size must be between 1 and 10000.');
    }
  }

  request(force = false): Promise<void> {
    if (this.#closed) {
      return Promise.resolve();
    }

    const range = this.#normalizeRange(this.#options.getRange());

    if (!force && !this.#running && this.#options.hasCachedRange(range)) {
      return Promise.resolve();
    }

    this.#desiredRange = range;
    this.#pending = true;

    if (!this.#running) {
      this.#drainPromise = this.#drain();
    }

    return this.#drainPromise ?? Promise.resolve();
  }

  close(): void {
    this.#closed = true;
    this.#pending = false;
  }

  #normalizeRange(range: VisibleRange): VisibleRange {
    if (
      !Number.isSafeInteger(range.first) ||
      !Number.isSafeInteger(range.last) ||
      range.first < 0 ||
      range.last < range.first
    ) {
      throw new RangeError('Visible range must contain valid non-negative indices.');
    }

    return { first: range.first, last: Math.min(range.last, range.first + this.#maxLimit - 1) };
  }

  async #drain(): Promise<void> {
    this.#running = true;

    try {
      while (this.#pending && !this.#closed) {
        const requested = this.#desiredRange;

        this.#pending = false;

        const limit = requested.last - requested.first + 1;
        const page = await this.#options.query(requested.first, limit);

        if (this.#closed) {
          return;
        }

        const expectedTotal = this.#options.getExpectedTotal();

        if (expectedTotal !== null && page.total !== expectedTotal) {
          throw new Error(
            `Worker returned ${page.total} records; simulation reports ${expectedTotal}.`,
          );
        }

        this.#pending = false;

        const latestRange = this.#normalizeRange(this.#options.getRange());

        if (page.records.length === 0 && latestRange.first >= page.total) {
          this.#options.onPage(page);
          continue;
        }

        if (coversRange(page, latestRange)) {
          this.#options.onPage(page);
          continue;
        }

        if (this.#options.hasCachedRange(latestRange)) {
          continue;
        }

        this.#desiredRange = latestRange;
        this.#pending = true;
      }
    } catch (error) {
      this.#pending = false;

      if (!this.#closed) {
        this.#options.onError(error);
      }
    } finally {
      this.#running = false;
      this.#drainPromise = null;

      if (this.#pending && !this.#closed) {
        void this.request(true);
      }
    }
  }
}

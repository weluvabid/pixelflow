import type { PhotoRecord } from '../images.ts';

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export interface ImageWindow {
  readonly offset: number;
  readonly total: number;
  readonly records: readonly PhotoRecord[];
}

export class ImageWorkerClient {
  readonly #worker: Worker;
  readonly #pending = new Map<number, PendingRequest>();
  #nextId = 1;
  #closed = false;
  readonly ready: Promise<{ total: number }>;

  constructor(datasetBaseUrl: string) {
    this.#worker = new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' });
    this.#worker.onmessage = ({ data }) => {
      const pending = this.#pending.get(data?.id);
      if (!pending) return;
      this.#pending.delete(data.id);
      if (data.type === 'ERROR') pending.reject(new Error(data.message));
      else pending.resolve(data);
    };
    this.#worker.onerror = (event) => this.#failAll(new Error(event.message || 'Image worker failed.'));
    this.ready = this.#request<{ type: 'READY'; total: number }>({
      type: 'INIT',
      datasetBaseUrl,
    }).then(({ total }) => ({ total }));
  }

  async query(offset: number, limit: number): Promise<ImageWindow> {
    const result = await this.#request<{
      type: 'WINDOW';
      offset: number;
      total: number;
      records: PhotoRecord[];
    }>({ type: 'QUERY', offset, limit });

    if (!Array.isArray(result.records) || result.records.length > limit) {
      throw new Error('Image worker returned an invalid window.');
    }

    return result;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#worker.terminate();
    this.#failAll(new Error('Image worker client was closed.'));
  }

  #request<T>(message: Record<string, unknown>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error('Image worker client is closed.'));
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.#worker.postMessage({ ...message, id });
    });
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}

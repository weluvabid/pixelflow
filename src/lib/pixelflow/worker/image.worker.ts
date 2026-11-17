import { IMAGE_COUNT, IMAGE_SOURCES } from '../images.ts';
interface RequestMessage { readonly id: number; readonly type: 'INIT' | 'QUERY'; readonly offset?: number; readonly limit?: number; }
interface WorkerScope {
  onmessage: ((event: MessageEvent<RequestMessage>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;
let initialized = false;
scope.onmessage = ({ data }: MessageEvent<RequestMessage>) => {
  try {
    if (!data || !Number.isSafeInteger(data.id) || data.id < 1) throw new Error('Malformed image worker request.');
    if (data.type === 'INIT') {
      if (initialized) throw new Error('Image dataset has already been initialized.');
      initialized = true;
      scope.postMessage({ id: data.id, type: 'READY', total: IMAGE_COUNT, assets: IMAGE_SOURCES.length });
      return;
    }
    if (data.type === 'QUERY') {
      if (!initialized) throw new Error('Image dataset has not been initialized.');
      const { offset, limit } = data;
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(limit) || offset! < 0 || limit! < 0 || limit! > 10_000) throw new RangeError('Image query range is invalid.');
      const start = offset!; const count = Math.min(limit!, IMAGE_COUNT - start);
      const assetIds = new Uint16Array(Math.max(0, count));
      for (let index = 0; index < assetIds.length; index += 1) assetIds[index] = (start + index) % IMAGE_SOURCES.length;
      scope.postMessage({ id: data.id, type: 'WINDOW', offset: start, total: IMAGE_COUNT, assetIds }, [assetIds.buffer]);
      return;
    }
    throw new Error(`Unsupported image worker request: ${String(data.type)}.`);
  } catch (error) {
    scope.postMessage({ id: data?.id ?? 0, type: 'ERROR', message: error instanceof Error ? error.message : 'Unknown image worker failure.' });
  }
};

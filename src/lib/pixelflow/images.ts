export const IMAGE_TILE_SIZE = 164;
export const IMAGE_ROW_HEIGHT = 180;
export const IMAGE_COLUMNS = 4;
export const IMAGE_OVERSCAN_ROWS = 3;
export const IMAGE_CACHE_SIZE = 48;
export const IMAGE_FETCH_CONCURRENCY = 6;
export const IMAGE_DECODE_CONCURRENCY = 4;
export const IMAGE_OVERSCAN_DELAY_MS = 120;
export const IMAGE_FADE_DURATION_MS = 140;

export interface PhotoRecord {
  readonly id: string;
  readonly imageUrl: string;
  readonly width: number;
  readonly height: number;
  readonly photographer: string;
}

export function optimizedImageUrl(source: string): string {
  const url = new URL(source);

  url.searchParams.set('w', '480');
  url.searchParams.set('h', '480');
  url.searchParams.set('fit', 'crop');
  url.searchParams.set('crop', 'entropy');
  url.searchParams.set('auto', 'format');
  url.searchParams.set('q', '78');

  return url.toString();
}

export const IMAGE_SOURCES = [
  'https://images.unsplash.com/photo-1416138782774-a2149bc6d102',
  'https://images.unsplash.com/28/tree-sky.jpg',
  'https://images.unsplash.com/photo-1418833309618-f98e69067c54',
] as const;

export const IMAGE_COUNT = 5_000;
export const IMAGE_TILE_SIZE = 164;
export const IMAGE_ROW_HEIGHT = 180;
export const IMAGE_COLUMNS = 4;
export const IMAGE_OVERSCAN_ROWS = 3;

export function imageUrl(assetId: number): string {
  if (!Number.isSafeInteger(assetId) || assetId < 0 || assetId >= IMAGE_SOURCES.length) throw new RangeError(`Unknown image asset: ${assetId}.`);
  const url = new URL(IMAGE_SOURCES[assetId]);
  url.searchParams.set('w', '400'); url.searchParams.set('h', '400'); url.searchParams.set('fit', 'crop'); url.searchParams.set('crop', 'entropy'); url.searchParams.set('auto', 'format'); url.searchParams.set('q', '75');
  return url.toString();
}

export function getMatrixColumns(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    throw new RangeError('Viewport width must be a finite positive number.');
  }

  if (viewportWidth >= 900) {
    return 4;
  }

  if (viewportWidth >= 600) {
    return 2;
  }

  return 1;
}

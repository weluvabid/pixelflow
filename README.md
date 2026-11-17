# Pixelflow

A browser image-rendering experiment. Pixelflow displays a large collection of image records using Canvas 2D, with a dedicated Web Worker managing bounded viewport queries.

The main idea is to keep the number of decoded images and the amount of work per frame bounded. The collection can contain thousands of records, but the renderer only draws the images around the current viewport.

## How it works

The worker serves deterministic image-record windows and responds to requests for a limited range. It returns compact typed-array data containing asset identifiers rather than transferring image objects or large JavaScript object graphs.

The initial dataset contains 5,000 records backed by three Unsplash image URLs. Records repeat those source images for now; the downloaded TSV dataset can replace this temporary mapping once its parser is added.

Images are requested as they approach the viewport. The browser fetches and decodes them using `createImageBitmap()`. Decoding concurrency is bounded, and a small LRU cache keeps decoded bitmaps reusable without retaining every image in memory.

Canvas 2D draws visible image tiles plus overscan. The scrollable matrix has a logical height for the full collection without creating thousands of DOM image elements. Rendering is scheduled with `requestAnimationFrame`.

## Stack

- Node.js 26 LTS and pnpm 12
- Astro
- Svelte 5
- Iris UI
- TypeScript
- Web Workers
- Canvas 2D

## Development

```sh
pnpm install --frozen-lockfile
pnpm dev
```

## Verification

```sh
pnpm check
```

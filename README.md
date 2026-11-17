# Pixelflow

Pixelflow is a browser-based image-matrix experiment that pushes Canvas 2D beyond small illustrations and charts. It presents a collection of **~25,000 photographs** in a responsive, scrollable matrix while keeping the DOM independent of the collection size.

The idea was pretty simple: I wanted to push Canvas beyond its usual comfort zone.

Canvas is mostly associated with games, drawing and visual effects. I wanted to see whether it could handle something different — an entire image collection — without creating a DOM element for every image.

The interesting part was retaining a useful screen-reader experience through a lightweight, visually hidden DOM layer, without bringing back the thousands of DOM nodes I wanted to avoid in the first place.

## Rendering model

- **Canvas 2D** draws the visible image tiles and a small overscan region. The full collection contributes to the scrollable height; it does not create one DOM node per photograph.
- **A dedicated Web Worker** owns dataset access and answers bounded range queries. It loads compact JSON chunks on demand and keeps only a small chunk LRU in memory.
- **Viewport-priority image loading** fetches visible images first, delays overscan until scrolling settles, and aborts obsolete requests.
- **Bounded decoding and memory** use `createImageBitmap()`, limited fetch/decode concurrency, and an LRU of decoded bitmaps. The renderer closes evicted bitmaps.
- **Native scrolling** remains browser-driven. Canvas work is scheduled with `requestAnimationFrame`.
- **Accessibility** is provided through a bounded semantic list for the current viewport. Each item exposes its position in the full collection and photographer attribution. The Canvas is hidden from the accessibility tree to avoid duplicate representations.

The semantic layer does not currently describe the visual contents of each photograph. It exposes the available metadata (position and photographer).

## Live measurements

The performance dock reports:

- Frame rate
- Canvas render duration
- Worker query duration
- Number of decoded images currently retained
- A bounded rolling history of Canvas render duration

## Stack

- Node.js 26 LTS and pnpm 12
- Astro static output
- Svelte 5
- TypeScript
- Web Workers
- Canvas 2D
- Iris UI

## Development

```sh
pnpm install --frozen-lockfile
pnpm dev
```

## Dataset

The checked-in generated dataset contains 24,997 records in 50 chunks of up to 500 records each.

To regenerate it from the source Unsplash TSV:

```sh
pnpm dataset:prepare
pnpm dataset:build
```

## Verification

Run the complete local quality gate:

```sh
pnpm check
```

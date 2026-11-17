<script lang="ts">
  import { onMount } from 'svelte';
  import * as ScrollArea from '@weluvabid/iris/components/ui/scroll-area';
  import LivePerformanceDock from './LivePerformanceDock.svelte';
  import { ImageWorkerClient } from '@lib/pixelflow/worker/client.ts';
  import { CanvasImageRenderer } from '@lib/pixelflow/dashboard/canvas-image-renderer.ts';
  import { VisibleWindowController } from '@lib/chronos/dashboard/visible-window.ts';
  import { IMAGE_COLUMNS, IMAGE_OVERSCAN_ROWS, IMAGE_ROW_HEIGHT } from '@lib/pixelflow/images.ts';
  import { getMatrixColumns } from '@lib/chronos/dashboard/matrix-model.ts';

  let scrollElement: HTMLElement | null = $state(null);
  let spacerElement: HTMLDivElement | null = $state(null);
  let canvasElement: HTMLCanvasElement | null = $state(null);
  let total = $state(0);
  let columns = $state(IMAGE_COLUMNS);
  let assetIds = $state(new Uint16Array());
  let windowOffset = $state(0);
  let status = $state<'initializing' | 'ready' | 'error'>('initializing');
  let errorMessage = $state('');
  let renderMs = $state(0);
  let workerMs = $state(0);
  let visibleImages = $state(0);
  let fps = $state(0);
  let frameSamples = $state<number[]>([]);
  let renderer: CanvasImageRenderer | null = null;
  let controller: VisibleWindowController<number> | null = null;

  function getRange() {
    const viewportHeight = Math.max(1, scrollElement?.clientHeight ?? 1);
    const scrollTop = scrollElement?.scrollTop ?? 0;
    const rows = Math.ceil(total / columns);
    const firstRow = Math.max(0, Math.floor(scrollTop / IMAGE_ROW_HEIGHT) - IMAGE_OVERSCAN_ROWS);
    const lastRow = Math.min(rows - 1, Math.ceil((scrollTop + viewportHeight) / IMAGE_ROW_HEIGHT) - 1 + IMAGE_OVERSCAN_ROWS);
    return { first: firstRow * columns, last: Math.max(firstRow * columns, Math.min(total - 1, (lastRow + 1) * columns - 1)) };
  }

  function requestWindow(force = false): Promise<void> { return controller?.request(force) ?? Promise.resolve(); }
  function draw(): void { renderer?.schedule(); }
  function handleScroll(): void { void requestWindow(); draw(); }
  function handleResize(): void { void requestWindow(true); draw(); }

  onMount(() => {
    const worker = new ImageWorkerClient();
    let disposed = false;
    let lastMetrics = 0;
    let lastHistory = 0;
    renderer = new CanvasImageRenderer({
      getCanvas: () => canvasElement,
      getScroller: () => scrollElement,
      getScrollTop: () => scrollElement?.scrollTop ?? 0,
      getViewportHeight: () => scrollElement?.clientHeight ?? 1,
      getAssetIds: () => assetIds,
      getWindowOffset: () => windowOffset,
      getTotal: () => total,
      getColumns: () => columns,
      onImageError: (error) => { errorMessage = error.message; },
      onMetrics: (metrics) => {
        const now = performance.now();
        if (now - lastMetrics >= 250) { renderMs = metrics.renderMs; visibleImages = metrics.visibleImages; lastMetrics = now; }
        if (window.innerWidth >= 768 && now - lastHistory >= 500) { frameSamples = [...frameSamples.slice(-47), metrics.renderMs]; lastHistory = now; }
      },
    });
    controller = new VisibleWindowController<number>({
      query: async (offset, limit) => {
        const started = performance.now();
        const page = await worker.query(offset, limit);
        workerMs = performance.now() - started;
        return { offset: page.offset, total: page.total, records: Array.from(page.assetIds) };
      },
      getRange,
      hasCachedRange: ({ first, last }) => first >= windowOffset && last < windowOffset + assetIds.length,
      getExpectedTotal: () => total || null,
      onPage: (page) => { assetIds = Uint16Array.from(page.records); windowOffset = page.offset; draw(); },
      onError: (error) => { errorMessage = error instanceof Error ? error.message : 'Unable to retrieve image records.'; status = 'error'; },
    });

    let frameCount = 0;
    let lastFpsSample = performance.now();
    let fpsFrame = 0;
    const sampleFps = (now: number) => {
      if (disposed) return;
      frameCount += 1;
      if (now - lastFpsSample >= 1_000) { fps = Math.round(frameCount * 1_000 / (now - lastFpsSample)); frameCount = 0; lastFpsSample = now; }
      fpsFrame = requestAnimationFrame(sampleFps);
    };
    fpsFrame = requestAnimationFrame(sampleFps);
    const resizeObserver = new ResizeObserver(() => {
      const nextColumns = getMatrixColumns(spacerElement?.clientWidth ?? window.innerWidth);
      if (nextColumns !== columns) { columns = nextColumns; void requestWindow(true); }
      draw();
    });
    if (scrollElement) { resizeObserver.observe(scrollElement); scrollElement.addEventListener('scroll', handleScroll, { passive: true }); }
    if (spacerElement) resizeObserver.observe(spacerElement);
    window.addEventListener('resize', handleResize, { passive: true });

    void worker.ready.then(async (summary) => {
      if (disposed) return;
      total = summary.total;
      status = 'ready';
      await requestWindow(true);
      draw();
    }).catch((error: unknown) => {
      if (disposed) return;
      errorMessage = error instanceof Error ? error.message : 'Image worker failed to initialize.';
      status = 'error';
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(fpsFrame);
      resizeObserver.disconnect();
      scrollElement?.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      renderer?.destroy(); controller?.close(); worker.close();
      renderer = null; controller = null;
    };
  });
</script>

<section class="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4 sm:gap-6">
  {#if errorMessage}<div role="alert" class="border-y border-destructive/40 py-3 text-sm text-destructive">{errorMessage}</div>{/if}
  <div class="flex shrink-0 items-center justify-between gap-3">
    <div>
      <p class="text-xs font-semibold uppercase tracking-[0.18em]">Image matrix {#if total > 0}[{columns} columns]{/if}</p>
      <p class="mt-1 text-xs text-muted-foreground">{total.toLocaleString()} image records · {3} source photographs · Canvas 2D</p>
    </div>
  </div>
  <ScrollArea.Root bind:viewportRef={scrollElement} orientation="vertical" class="relative min-h-[180px] min-w-0 flex-1" aria-label="Photograph collection">
    {#if total === 0}
      <div class="grid min-h-72 w-full place-items-center px-4 text-center text-sm text-muted-foreground">{status === 'initializing' ? 'Loading image collection…' : 'Waiting for image worker…'}</div>
    {:else}
      <div bind:this={spacerElement} class="relative w-full" style={`height:${Math.ceil(total / columns) * IMAGE_ROW_HEIGHT}px`}>
        <canvas bind:this={canvasElement} class="sticky top-0 z-10 block w-full bg-background touch-pan-y" aria-hidden="true"></canvas>
      </div>
    {/if}
  </ScrollArea.Root>
  <LivePerformanceDock {fps} {renderMs} {workerMs} {visibleImages} {frameSamples} />
</section>

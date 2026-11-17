<script lang="ts">
  import { onMount } from 'svelte';
  import * as Dialog from '@weluvabid/iris/components/ui/dialog';
  import * as ScrollArea from '@weluvabid/iris/components/ui/scroll-area';
  import LivePerformanceDock from './LivePerformanceDock.svelte';
  import { ChronosWorkerClient } from '@lib/chronos/worker/client.ts';
  import { CanvasMatrixRenderer } from '@lib/chronos/dashboard/canvas-matrix-renderer.ts';
  import { VisibleWindowController } from '@lib/chronos/dashboard/visible-window.ts';
  import {
    getMatrixColumns,
    getVisibleMatrixRows,
    getVisibleTimerRange,
    MATRIX_COLUMNS,
    MATRIX_ROW_HEIGHT,
    TARGET_TIMER_COUNT,
    timerId,
    timerName,
    timerStatus,
    type MatrixRowRange,
  } from '@lib/chronos/dashboard/matrix-model.ts';
  import { elapsedAt, formatDuration } from '@lib/chronos/dashboard/timer-format.ts';
  import { appendPerformanceSample } from '@lib/chronos/dashboard/performance-history.ts';
  import type { TimerRecord, TimerMatrixSummary } from '@lib/chronos/simulation/timer-matrix.ts';

  const OVERSCAN_ROWS = 3;
  const GRAPH_SAMPLES = 48;
  const METRICS_UPDATE_INTERVAL_MS = 250;
  const HISTORY_SAMPLE_INTERVAL_MS = 500;
  let scrollElement: HTMLElement | null = $state(null);
  let matrixSpacerElement: HTMLDivElement | null = $state(null);
  let canvasElement: HTMLCanvasElement | null = $state(null);
  let summary = $state<TimerMatrixSummary | null>(null);
  let records = $state<TimerRecord[]>([]);
  let windowOffset = $state(0);
  let rowCount = $state(0);
  let matrixColumns = $state(MATRIX_COLUMNS);
  let status = $state<'initializing' | 'ready' | 'error'>('initializing');
  let errorMessage = $state('');
  let selectedHandle = $state<number | null>(null);
  let selectedRecord = $state<TimerRecord | null>(null);
  let selectedNow = $state(0);
  let hoveredHandle = $state<number | null>(null);
  let renderMs = $state(0);
  let workerMs = $state(0);
  let visibleTimers = $state(0);
  let fps = $state(0);
  let frameSamples = $state<number[]>([]);
  let renderer: CanvasMatrixRenderer | null = null;
  let windowController: VisibleWindowController<TimerRecord> | null = null;
  let client: ChronosWorkerClient | null = null;

  function matrixScrollTop(): number {
    return scrollElement?.scrollTop ?? 0;
  }

  function matrixViewportHeight(): number {
    return Math.max(1, scrollElement?.clientHeight ?? 1);
  }

  function visibleRows(): MatrixRowRange {
    return getVisibleMatrixRows(matrixScrollTop(), matrixViewportHeight(), rowCount, OVERSCAN_ROWS);
  }

  function visibleRange() {
    return getVisibleTimerRange(
      matrixScrollTop(),
      matrixViewportHeight(),
      rowCount,
      summary?.timers ?? 0,
      OVERSCAN_ROWS,
      matrixColumns,
    );
  }

  function scheduleDraw(): void {
    renderer?.schedule();
  }

  function requestVisibleWindow(force = false): Promise<void> {
    if (summary === null || windowController === null) {
      return Promise.resolve();
    }

    return windowController.request(force);
  }

  function handleScroll(): void {
    void requestVisibleWindow();
    scheduleDraw();
  }

  function handleViewportResize(): void {
    const nextColumns = getMatrixColumns(matrixSpacerElement?.clientWidth ?? window.innerWidth);

    if (nextColumns !== matrixColumns) {
      matrixColumns = nextColumns;
      rowCount = Math.ceil((summary?.timers ?? 0) / matrixColumns);

      void requestVisibleWindow(true);
    }

    scheduleDraw();
  }

  function handlePointerMove(event: PointerEvent): void {
    const next = renderer?.hitTest(event.clientX, event.clientY) ?? null;

    if (next !== hoveredHandle) {
      hoveredHandle = next;

      scheduleDraw();

      if (canvasElement) {
        canvasElement.style.cursor = next === null ? 'default' : 'pointer';
      }
    }
  }

  function handlePointerLeave(): void {
    hoveredHandle = null;

    if (canvasElement) {
      canvasElement.style.cursor = 'default';
    }
  }

  function handleCanvasClick(event: MouseEvent): void {
    const handle = renderer?.hitTest(event.clientX, event.clientY) ?? null;

    if (handle === null || selectedHandle === handle) {
      selectedHandle = null;
      selectedRecord = null;
    } else {
      selectedHandle = handle;
      selectedRecord = records[handle - windowOffset] ?? null;
    }

    scheduleDraw();
  }

  async function initialize(): Promise<void> {
    const worker = client;

    if (worker === null || summary !== null) {
      return;
    }

    status = 'initializing';

    try {
      summary = await worker.loadSimulation(TARGET_TIMER_COUNT, 0x00c0ffee);
      rowCount = Math.ceil(summary.timers / matrixColumns);

      await requestVisibleWindow(true);

      status = 'ready';

      scheduleDraw();
    } catch (error) {
      errorMessage =
        error instanceof Error ? error.message : 'Unable to initialize the timer population.';
      status = 'error';
    }
  }

  function selectNext(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      selectedHandle = null;
      selectedRecord = null;

      scheduleDraw();
    }
  }

  onMount(() => {
    const worker = ChronosWorkerClient.create();
    let lastMetricsUpdate = Number.NEGATIVE_INFINITY;
    let lastHistorySample = Number.NEGATIVE_INFINITY;

    client = worker;
    renderer = new CanvasMatrixRenderer({
      getCanvas: () => canvasElement,
      getScroller: () => scrollElement,
      getScrollTop: matrixScrollTop,
      getViewportHeight: matrixViewportHeight,
      getRows: visibleRows,
      getRecords: () => records,
      getWindowOffset: () => windowOffset,
      getTimerCount: () => summary?.timers ?? 0,
      getColumns: () => matrixColumns,
      getSelectedHandle: () => selectedHandle,
      getHoveredHandle: () => hoveredHandle,
      onMetrics: (metrics) => {
        const now = performance.now();

        if (now - lastMetricsUpdate >= METRICS_UPDATE_INTERVAL_MS) {
          renderMs = metrics.renderMs;
          visibleTimers = metrics.visibleTimers;
          lastMetricsUpdate = now;
        }

        if (window.innerWidth >= 768 && now - lastHistorySample >= HISTORY_SAMPLE_INTERVAL_MS) {
          frameSamples = appendPerformanceSample(frameSamples, metrics.renderMs, GRAPH_SAMPLES);
          lastHistorySample = now;
        }
      },
    });
    windowController = new VisibleWindowController<TimerRecord>({
      query: async (offset, limit) => {
        const started = performance.now();
        const page = await worker.queryWindow(offset, limit);

        workerMs = performance.now() - started;

        return page;
      },
      getRange: visibleRange,
      hasCachedRange: ({ first, last }) =>
        first >= windowOffset && last < windowOffset + records.length,
      getExpectedTotal: () => summary?.timers ?? null,
      onPage: (page) => {
        records = [...page.records];
        windowOffset = page.offset;

        scheduleDraw();
      },
      onError: (error) => {
        errorMessage = error instanceof Error ? error.message : 'Unable to retrieve timer data.';
        status = 'error';
      },
    });

    let disposed = false;
    let frameCount = 0;
    let lastFpsSample = performance.now();
    let fpsFrame = 0;
    const sampleFps = (now: number) => {
      if (disposed) {
        return;
      }

      frameCount += 1;

      if (now - lastFpsSample >= 1_000) {
        fps = Math.round((frameCount * 1_000) / (now - lastFpsSample));
        frameCount = 0;
        lastFpsSample = now;
      }

      fpsFrame = requestAnimationFrame(sampleFps);
    };

    fpsFrame = requestAnimationFrame(sampleFps);

    const tickHandle = window.setInterval(() => {
      if (status === 'ready') {
        scheduleDraw();
      }
    }, 1_000);
    const resizeObserver = new ResizeObserver(() => {
      handleViewportResize();
    });

    if (scrollElement !== null) {
      resizeObserver.observe(scrollElement);
      scrollElement.addEventListener('scroll', handleScroll, { passive: true });
    }

    if (matrixSpacerElement !== null) {
      resizeObserver.observe(matrixSpacerElement);
    }

    window.addEventListener('resize', handleViewportResize, { passive: true });
    const handleThemeChange = () => renderer?.invalidateTheme();

    document.addEventListener('chronos:themechange', handleThemeChange);

    void worker.ready
      .then(() => {
        if (disposed) {
          return;
        }

        return initialize();
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }

        errorMessage =
          error instanceof Error ? error.message : 'Chronos worker failed to initialize.';
        status = 'error';
      });

    const reconcile = () => {
      if (document.visibilityState === 'visible') {
        void worker.reconcile();
        void requestVisibleWindow(true);
        scheduleDraw();
      }
    };

    document.addEventListener('visibilitychange', reconcile);
    window.addEventListener('pageshow', reconcile);

    return () => {
      disposed = true;

      cancelAnimationFrame(fpsFrame);
      window.clearInterval(tickHandle);
      resizeObserver.disconnect();
      scrollElement?.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleViewportResize);
      document.removeEventListener('chronos:themechange', handleThemeChange);
      document.removeEventListener('visibilitychange', reconcile);
      window.removeEventListener('pageshow', reconcile);
      renderer?.destroy();
      windowController?.close();
      worker.close();

      renderer = null;
      windowController = null;
      client = null;
    };
  });

  $effect(() => {
    if (summary !== null && matrixSpacerElement !== null) {
      matrixColumns = getMatrixColumns(matrixSpacerElement.clientWidth);
      rowCount = Math.ceil(summary.timers / matrixColumns);

      void requestVisibleWindow(true);
    }
  });

  $effect(() => {
    if (selectedHandle === null || selectedRecord === null) {
      return;
    }

    selectedNow = performance.timeOrigin + performance.now();

    const interval = window.setInterval(() => {
      selectedNow = performance.timeOrigin + performance.now();
    }, 1_000);

    return () => window.clearInterval(interval);
  });

  function selectedElapsed(): string {
    return selectedRecord === null
      ? '—'
      : formatDuration(elapsedAt(selectedRecord.startedAt, selectedNow));
  }
</script>

<svelte:window onkeydown={selectNext} />

<section class="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4 sm:gap-6">
  {#if errorMessage}
    <div role="alert" class="border-y border-destructive/40 py-3 text-sm text-destructive">
      {errorMessage}
    </div>
  {/if}

  <div class="flex shrink-0 items-center justify-between gap-3">
    <div>
      <p class="text-xs font-semibold uppercase tracking-[0.18em]">
        Live timer matrix {#if summary !== null}
          [{matrixColumns} column(s)]
        {/if}
      </p>
      <p class="mt-1 text-xs text-muted-foreground">100,000 independent timers · Canvas-rendered</p>
    </div>
  </div>

  <ScrollArea.Root
    bind:viewportRef={scrollElement}
    orientation="vertical"
    class="relative min-h-[180px] min-w-0 flex-1"
    aria-label="100,000 continuously running timers"
  >
    {#if summary === null}
      <div
        class="grid min-h-72 w-full place-items-center px-4 text-center text-sm text-muted-foreground"
      >
        {status === 'initializing' ? 'Starting 100,000 timers…' : 'Waiting for timer engine…'}
      </div>
    {:else}
      <div
        bind:this={matrixSpacerElement}
        class="relative w-full"
        style={`height:${rowCount * MATRIX_ROW_HEIGHT}px`}
      >
        <canvas
          bind:this={canvasElement}
          class="sticky top-0 z-10 block w-full bg-background touch-pan-y"
          aria-hidden="true"
          tabindex="-1"
          onpointermove={handlePointerMove}
          onpointerleave={handlePointerLeave}
          onclick={handleCanvasClick}
        ></canvas>
      </div>
    {/if}
  </ScrollArea.Root>

  <LivePerformanceDock {fps} {renderMs} {workerMs} {visibleTimers} {frameSamples} />

  <Dialog.Root
    open={selectedHandle !== null}
    onOpenChange={(open) => {
      if (!open) {
        selectedHandle = null;
        selectedRecord = null;

        scheduleDraw();
      }
    }}
  >
    <Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
      {#if selectedHandle !== null}
        <Dialog.Header>
          <Dialog.Title>Timer inspector</Dialog.Title>
          <Dialog.Description
            >{timerId(selectedHandle)} · {timerName(selectedHandle)}</Dialog.Description
          >
        </Dialog.Header>
        <div class="space-y-4">
          <div>
            <p class="font-mono text-3xl font-semibold tabular-nums">{selectedElapsed()}</p>
            <p class="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Elapsed time · {selectedRecord ? timerStatus(selectedRecord.handle) : '—'}
            </p>
          </div>
          {#if selectedRecord}
            <div class="rounded-lg border border-border bg-muted/30 p-3">
              <p class="text-xs text-muted-foreground">Started</p>
              <p class="mt-1 font-mono text-sm">
                {new Date(selectedRecord.startedAt).toLocaleTimeString()}
              </p>
            </div>
          {/if}
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Root>
</section>

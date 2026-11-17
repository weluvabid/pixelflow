<script lang="ts">
  import { buildPerformancePolyline } from '@lib/pixelflow/dashboard/performance-history.ts';

  let {
    fps,
    renderMs,
    workerMs,
    loadedImages,
    frameSamples,
  }: {
    fps: number;
    renderMs: number;
    workerMs: number;
    loadedImages: number;
    frameSamples: readonly number[];
  } = $props();

  const graphPoints = $derived(buildPerformancePolyline(frameSamples, 320, 70, 9));
</script>

<section
  class="-mx-4 shrink-0 border-t border-border bg-background px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:-mx-6 sm:px-6 sm:pt-4"
  aria-label="Live performance"
>
  <div class="mx-auto w-full max-w-5xl">
    <p class="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
      Live performance
    </p>
    <div
      class="mt-3 flex justify-between text-center gap-x-8 gap-y-2 border-t border-border pt-3 sm:mt-4 sm:gap-x-10 sm:gap-y-3 sm:pt-4"
    >
      <div class="min-w-0">
        <p class="text-[9px] uppercase tracking-wider text-muted-foreground sm:text-[10px]">
          Frame rate
        </p>
        <p class="mt-0.5 font-mono text-lg tabular-nums sm:mt-1 sm:text-xl">
          {fps}<span class="ml-1 text-[10px] text-muted-foreground sm:text-xs">FPS</span>
        </p>
      </div>
      <div class="min-w-0">
        <p class="text-[9px] uppercase tracking-wider text-muted-foreground sm:text-[10px]">
          Canvas render
        </p>
        <p class="mt-0.5 font-mono text-lg tabular-nums sm:mt-1 sm:text-xl">
          {renderMs.toFixed(2)}<span class="ml-1 text-[10px] text-muted-foreground sm:text-xs"
            >ms</span
          >
        </p>
      </div>
      <div class="min-w-0">
        <p class="text-[9px] uppercase tracking-wider text-muted-foreground sm:text-[10px]">
          Worker query
        </p>
        <p class="mt-0.5 font-mono text-lg tabular-nums sm:mt-1 sm:text-xl">
          {workerMs.toFixed(2)}<span class="ml-1 text-[10px] text-muted-foreground sm:text-xs"
            >ms</span
          >
        </p>
      </div>
      <div class="min-w-0">
        <p class="text-[9px] uppercase tracking-wider text-muted-foreground sm:text-[10px]">
          Loaded images
        </p>
        <p class="mt-0.5 font-mono text-lg tabular-nums sm:mt-1 sm:text-xl">{loadedImages}</p>
      </div>
    </div>
    <div class="mt-3 hidden border-t border-border pt-3 md:block">
      <div class="mb-2 flex items-center justify-between">
        <p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Frame render history
        </p>
        <p class="font-mono text-[10px] text-muted-foreground">{frameSamples.length} samples</p>
      </div>
      <svg
        viewBox="0 0 320 70"
        preserveAspectRatio="none"
        class="h-20 w-full"
        role="img"
        aria-label="Rolling canvas render duration history"
      >
        <path
          d="M0 10H320 M0 35H320 M0 60H320"
          stroke="currentColor"
          opacity=".12"
          stroke-dasharray="3 4"
          fill="none"
        />
        {#if graphPoints}
          <polyline
            points={graphPoints}
            stroke="currentColor"
            stroke-width="1.8"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        {/if}
      </svg>
    </div>
  </div>
</section>

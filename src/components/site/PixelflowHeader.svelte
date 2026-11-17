<script lang="ts">
  import { onMount } from 'svelte';
  import { SiteHeader, Button, Tooltip } from '@weluvabid/iris/components';
  import { Moon, Sun } from '@weluvabid/iris/lucide';
  import { SiGithub } from '@weluvabid/iris/simple-icons';
  import { getInitialTheme, toggleTheme } from '@weluvabid/iris/theme';
  import ghostMarkOnDark from '../../../brand/me/brand/mark.svg?url';
  import ghostMarkOnLight from '../../../brand/me/brand/mark-dark.svg?url';

  let theme = $state<'light' | 'dark'>('light');
  let hydrated = $state(false);

  onMount(() => {
    theme = getInitialTheme();
    hydrated = true;
  });

  function handleThemeToggle(): void {
    theme = toggleTheme(theme);

    document.dispatchEvent(new CustomEvent('pixelflow:themechange', { detail: { theme } }));
  }
</script>

<Tooltip.Provider delayDuration={300}>
  <SiteHeader>
    <span class="inline-flex min-h-10 shrink-0 items-center" aria-hidden="true">
      <img src={ghostMarkOnDark} alt="" class="hidden h-8 w-[34.56px] dark:block" />
      <img src={ghostMarkOnLight} alt="" class="block h-8 w-[34.56px] dark:hidden" />
    </span>

    <nav class="flex shrink-0 items-center gap-1" aria-label="Primary navigation">
      <div class="flex items-center gap-1">
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button.Root
                {...props}
                variant="ghost"
                size="icon"
                class={hydrated ? 'rounded-full' : 'invisible rounded-full'}
                aria-label={hydrated
                  ? theme === 'dark'
                    ? 'Switch to light theme'
                    : 'Switch to dark theme'
                  : 'Theme'}
                aria-pressed={hydrated ? theme === 'dark' : undefined}
                onclick={handleThemeToggle}
              >
                {#if hydrated}
                  {#if theme === 'dark'}<Sun aria-hidden="true" />{:else}<Moon
                      aria-hidden="true"
                    />{/if}
                {/if}
              </Button.Root>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</Tooltip.Content>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button.Root
                {...props}
                variant="ghost"
                size="icon"
                class="rounded-full"
                href="https://github.com/weluvabid/pixelflow"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Pixelflow on GitHub (opens in a new tab)"
              >
                <SiGithub aria-hidden="true" />
              </Button.Root>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>GitHub repository</Tooltip.Content>
        </Tooltip.Root>
      </div>
    </nav>
  </SiteHeader>
</Tooltip.Provider>

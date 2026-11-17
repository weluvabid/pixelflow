import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'static',
  base: process.env.ASTRO_BASE_PATH ?? '/',
  trailingSlash: 'always',
  integrations: [svelte()],
  vite: {
    plugins: [tailwindcss()],
  },
  server: {
    host: true,
    allowedHosts: ['conference-wilderness-dat-machinery.trycloudflare.com'],
  },
});

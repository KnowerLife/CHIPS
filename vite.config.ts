/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

// CHIPS — web build config.
// `base: './'` keeps the bundle portable (GitHub Pages, itch.io, file:// preview).
export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173,
    open: false,
    // During `npm run dev` the game server (server/index.mjs) runs separately on
    // 8787; proxy API + push channel to it so the frontend stays same-origin.
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        // SSE must not be buffered by the proxy.
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (String(proxyRes.headers['content-type'] || '').includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache, no-transform';
            }
          });
        },
      },
    },
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:8000';

/**
 * Two-speed bundle (docs/11 §1):
 *  - citizen/helper/shared code is the eager entry graph (<= 150 KB gzip, enforced by `npm run budget`)
 *  - staff/admin/auditor live in their own lazy chunks and must never reach the citizen entry.
 */
function manualChunks(id: string): string | undefined {
  const norm = id.replace(/\\/g, '/');
  if (norm.includes('/node_modules/')) {
    if (norm.includes('/react-router')) return 'vendor-router';
    if (norm.includes('/@tanstack/')) return 'vendor-query';
    if (norm.includes('/dexie')) return 'vendor-db';
    if (norm.includes('/react-dom/') || norm.includes('/scheduler/')) return 'vendor-react';
    if (norm.includes('/node_modules/react/')) return 'vendor-react';
    return undefined;
  }
  // Keep the optional Sindhi dictionary in its own lazy chunk so the citizen
  // initial JS bundle stays well below the 150 KB gzipped budget.
  if (norm.includes('/src/shared/i18n/sindhi')) return 'i18n-sd';
  // ADR-025: the video guide is optional, so it must never join the `shared`
  // chunk - that chunk is in the citizen entry graph, and `@anam-ai/js-sdk`
  // alone would blow the 150 KB budget. Left unnamed, Rollup splits it at the
  // React.lazy() boundary in AvatarToggleCard/AvatarPiPBubble.
  if (norm.includes('/src/shared/avatar/')) return undefined;
  // Shared code is used by the citizen entry AND by every lazy console. Pin it
  // to its own chunk so Rollup never parks it inside a staff chunk - otherwise
  // the entry ends up statically importing `staff-*.js` and the budget gate
  // (correctly) fails.
  if (norm.includes('/src/shared/')) return 'shared';
  // Staff/admin/auditor are NOT named here on purpose. Naming them makes Rollup
  // hoist Vite's shared `__vite__mapDeps` helper into the staff chunk, which the
  // entry then imports statically - the budget gate catches that as a leak.
  // Left unnamed, Rollup splits them at the React.lazy() boundary instead.
  return undefined;
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.svg', 'icons/*.png'],
      manifest: {
        name: 'Haqdaar - سہارا امداد',
        short_name: 'Haqdaar',
        description: 'Prototype: apply for the Sahara Widow Support Grant by voice and pictures.',
        lang: 'ur',
        dir: 'rtl',
        start_url: '/c',
        scope: '/',
        display: 'standalone',
        background_color: '#FAF7F1',
        theme_color: '#0E6A60',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache app shell + fonts + icons + critical offline prompts only (<400 KB),
        // letting the remaining 73 Urdu MP3s stream lazily into the CacheFirst runtime cache.
        globPatterns: [
          '**/*.{js,css,html,svg,png,webp,woff2,json}',
          'audio/ur/{home_apply,offline_saved,wizard_queued,wizard_welcome,scam_intro}.mp3',
          'audio/sd/{home_apply,offline_saved,wizard_queued,wizard_welcome,scam_intro}.mp3',
        ],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/mock\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // docs/11 §5.1 - programs list is stable: serve from cache, refresh in background.
            urlPattern: /\/api\/v1\/programs(\?.*)?$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'api-programs',
              expiration: { maxEntries: 8, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          {
            // docs/11 §5.1 - case reads: network first, IndexedDB/Dexie is the deeper fallback.
            urlPattern: /\/api\/v1\/cases(\?.*)?$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cases',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 },
            },
          },
          {
            urlPattern: /\/audio\/ur\/.*\.mp3$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'urdu-audio',
              expiration: { maxEntries: 120, maxAgeSeconds: 90 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: /\/audio\/sd\/.*\.mp3$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'sindhi-audio',
              expiration: { maxEntries: 160, maxAgeSeconds: 90 * 24 * 60 * 60 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/mock': { target: API_TARGET, changeOrigin: true },
    },
  },
  preview: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/mock': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    sourcemap: false,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        manualChunks,
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
});

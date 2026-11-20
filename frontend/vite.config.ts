import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// Two-speed frontend (docs/11 §1): the citizen/helper PWA must stay <= 150 KB gzipped,
// so everything staff-only lives in lazily loaded chunks.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_PROXY ?? 'http://127.0.0.1:8000';

  return {
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/*.svg', 'audio/ur/*.mp3'],
        manifest: {
          name: 'Haqdaar (Prototype)',
          short_name: 'Haqdaar',
          description: 'Prototype — not an official government service.',
          lang: 'ur',
          dir: 'rtl',
          start_url: '/',
          display: 'standalone',
          background_color: '#FBF8F3',
          theme_color: '#14532D',
          icons: [
            { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
          ],
        },
        workbox: {
          // Precache only the citizen shell; staff chunks are fetched on demand.
          globPatterns: ['**/*.{js,css,html,svg,woff2,mp3}'],
          globIgnores: ['**/staff-*.js', '**/devmock-*.js'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/mock\//, /^\/health/],
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname === '/api/v1/programs',
              handler: 'StaleWhileRevalidate',
              options: { cacheName: 'programs' },
            },
            {
              urlPattern: ({ url }) => url.pathname.startsWith('/api/v1/cases'),
              method: 'GET',
              handler: 'NetworkFirst',
              options: { cacheName: 'cases', networkTimeoutSeconds: 6 },
            },
            {
              urlPattern: ({ url }) => url.pathname.startsWith('/audio/'),
              handler: 'CacheFirst',
              options: { cacheName: 'audio', expiration: { maxEntries: 200 } },
            },
          ],
        },
      }),
    ],
    server: {
      port: 5173,
      proxy: {
        '/api': apiTarget,
        '/mock': apiTarget,
        '/health': apiTarget,
      },
    },
    build: {
      target: 'es2020',
      rollupOptions: {
        output: {
          // React.lazy already splits staff code; we only name those chunks so the
          // service worker can skip precaching them (they are not citizen assets).
          chunkFileNames(chunk) {
            const ids = chunk.moduleIds.map((m) => m.replace(/\\/g, '/'));
            const citizenSide = ids.some((m) => /\/src\/(citizen|helper|pages)\//.test(m));
            if (!citizenSide && ids.some((m) => m.includes('/src/staff/'))) return 'assets/staff-[name]-[hash].js';
            if (ids.some((m) => m.includes('/src/shared/devmock/'))) return 'assets/devmock-[name]-[hash].js';
            return 'assets/[name]-[hash].js';
          },
        },
      },
    },
  };
});

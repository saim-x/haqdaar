import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against the live integration stack.
 *
 * The dev server proxies /api and /mock to the backend on :8000, so the specs
 * exercise the real FastAPI app, the real decision engine, and the real mocks —
 * no fixture layer anywhere.
 *
 * Run:  npm run e2e
 * Requires the backend on http://127.0.0.1:8000 (docker compose up).
 */
export default defineConfig({
  testDir: './src/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'ur-PK',
    // 390x844 — the phone the citizen PWA is designed for (docs/11 §1).
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5174',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

/** Runtime configuration. Everything is same-origin in production (docs/03 §1.5). */

export const API_BASE = '/api/v1';
export const MOCK_BASE = '/mock/v1';

/**
 * Scaffolding-only escape hatch. When `VITE_USE_MOCK_API=true` the API client
 * answers from a localStorage fixture layer so screens can be built before the
 * backend lands. Every P0 flow must be verified against the real backend before
 * the C2 checkpoint — this flag is never enabled in a build we ship.
 */
export const USE_MOCK_API = import.meta.env.VITE_USE_MOCK_API === 'true';

export const APP_NAME = 'Haqdaar';
export const APP_NAME_UR = 'حقدار';

/** docs/11 §2.7 — Lite Mode auto-enables on these effective connection types. */
export const LITE_AUTO_TYPES = ['slow-2g', '2g'];

/** docs/11 §5.3 — outbox retry backoff in milliseconds. */
export const OUTBOX_BACKOFF_MS = [2_000, 5_000, 15_000, 30_000];

/** AC-10.2 — status polling floor and ceiling. */
export const POLL_MIN_MS = 5_000;
export const POLL_MAX_MS = 60_000;

export const STORAGE_KEYS = {
  auth: 'haqdaar.auth.v1',
  lang: 'haqdaar.lang.v1',
  lite: 'haqdaar.lite.v1',
  autoRead: 'haqdaar.autoread.v1',
  actFor: 'haqdaar.actfor.v1',
  mockApi: 'haqdaar.mockapi.v1',
} as const;

import { authStore } from '../auth/store';
import type { ApiErrorBody } from './types';

// Typed REST client (docs/05 §1): attaches Authorization, X-Act-For-Citizen,
// Idempotency-Key, honours ETag / 304, refreshes expired access tokens once,
// and normalises every failure into ApiError with bilingual messages.

export const API_BASE = '/api/v1';

export class ApiError extends Error {
  status: number;
  code: string;
  messageUr: string;
  details?: Record<string, unknown>;
  requestId?: string;
  /** true when the request never reached the server (offline / DNS / timeout). */
  network: boolean;

  constructor(status: number, code: string, en: string, ur: string, opts: Partial<ApiError> = {}) {
    super(en);
    this.status = status;
    this.code = code;
    this.messageUr = ur;
    this.details = opts.details;
    this.requestId = opts.requestId;
    this.network = opts.network ?? false;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
  idempotencyKey?: string;
  /** Override acting-for header (null = never send it). */
  actFor?: string | null;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Absolute path (e.g. '/mock/v1/...') instead of API_BASE-relative. */
  raw?: boolean;
}

const etagCache = new Map<string, { etag: string; body: unknown }>();

function buildUrl(path: string, opts: RequestOptions): string {
  const base = opts.raw ? path : `${API_BASE}${path}`;
  if (!opts.query) return base;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const { refreshToken } = authStore.get();
  if (!refreshToken) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { access_token: string; refresh_token: string };
      authStore.set({ accessToken: data.access_token, refreshToken: data.refresh_token });
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

export async function request<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const method = opts.method ?? 'GET';
  const url = buildUrl(path, opts);
  const headers: Record<string, string> = { Accept: 'application/json' };
  const auth = authStore.get();

  if (auth.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`;
  const actFor = opts.actFor === undefined ? auth.actingFor?.citizenId : opts.actFor;
  if (actFor && auth.user?.role === 'HELPER') headers['X-Act-For-Citizen'] = actFor;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const cacheKey = `${url}|${actFor ?? ''}`;
  const cached = method === 'GET' ? etagCache.get(cacheKey) : undefined;
  if (cached) headers['If-None-Match'] = cached.etag;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000);
  opts.signal?.addEventListener('abort', () => controller.abort());

  let res: Response;
  try {
    res = await fetch(url, { method, headers, body, signal: controller.signal });
  } catch {
    throw new ApiError(
      0,
      'NETWORK',
      'No connection. Your progress is saved on this phone.',
      'انٹرنیٹ نہیں ہے۔ آپ کی معلومات اس فون پر محفوظ ہے۔',
      { network: true },
    );
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 304 && cached) return cached.body as T;

  if (res.status === 401 && !retried && !path.startsWith('/auth/') && (await tryRefresh())) {
    return request<T>(path, opts, true);
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const env = (data as ApiErrorBody | null)?.error;
    if (res.status === 401 && !path.startsWith('/auth/')) authStore.clear();
    throw new ApiError(
      res.status,
      env?.code ?? `HTTP_${res.status}`,
      env?.message_en ?? `Request failed (${res.status}).`,
      env?.message_ur ?? 'درخواست مکمل نہیں ہو سکی۔',
      { details: env?.details, requestId: env?.request_id ?? res.headers.get('X-Request-ID') ?? undefined },
    );
  }

  const etag = res.headers.get('ETag');
  if (method === 'GET' && etag) etagCache.set(cacheKey, { etag, body: data });
  return data as T;
}

export function clearEtagCache() {
  etagCache.clear();
}

export const uuid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

/**
 * Typed REST client - docs/05 §1.
 *
 * Responsibilities:
 *  - `Authorization: Bearer <access_jwt>` on every authenticated call
 *  - `X-Act-For-Citizen: <citizen_uuid>` whenever a helper is acting for a family
 *  - `Idempotency-Key: <uuid>` on every mutating citizen/helper call (auto-generated)
 *  - uniform error-envelope parsing into `ApiError` (code / message_ur / message_en / details)
 *  - `If-None-Match` / `304 Not Modified` handling for ETag polling
 *  - `X-Request-ID` passthrough so a UI error can be traced in the audit log
 *  - single-flight refresh on 401, then one retry
 */
import { API_BASE } from '../config';
import { ApiError, type ApiErrorCode, type ApiErrorEnvelope } from './errors';
import { uuid } from '../lib/uuid';

export interface AuthBridge {
  getAccessToken(): string | null;
  getActForCitizen(): string | null;
  /** Returns a fresh access token, or null when the session is gone. */
  refresh(): Promise<string | null>;
  onUnauthorized(): void;
}

let bridge: AuthBridge | null = null;

export function setAuthBridge(next: AuthBridge | null): void {
  bridge = next;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** multipart/form-data payload; mutually exclusive with `body`. */
  form?: FormData;
  /** Explicit Idempotency-Key. Auto-generated for mutations when omitted. */
  idempotencyKey?: string;
  /** ETag from a previous response; a 304 resolves to `{ notModified: true }`. */
  ifNoneMatch?: string | null;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Skip the Authorization header (public endpoints: /scam/check, /transparency). */
  anonymous?: boolean;
  /** Do not attempt refresh+retry on 401 (used by the refresh call itself). */
  noRetry?: boolean;
  /** Override the base path (e.g. MOCK_BASE for the device simulator). */
  base?: string;
}

export interface ApiResponse<T> {
  data: T | null;
  notModified: boolean;
  etag: string | null;
  status: number;
  requestId: string | null;
}

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

function buildUrl(path: string, base: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${prefix}${path.startsWith('/') ? path : `/${path}`}`;
}

async function parseError(res: Response): Promise<ApiError> {
  let code: ApiErrorCode = 'UNKNOWN';
  let messageEn = res.statusText || 'Request failed';
  let messageUr = 'درخواست ناکام ہو گئی۔';
  let requestId: string | null = res.headers.get('X-Request-ID');
  let details: Record<string, unknown> = {};
  try {
    const payload = (await res.json()) as Partial<ApiErrorEnvelope>;
    if (payload && typeof payload === 'object' && payload.error) {
      code = payload.error.code ?? code;
      messageEn = payload.error.message_en ?? messageEn;
      messageUr = payload.error.message_ur ?? messageUr;
      requestId = payload.error.request_id ?? requestId;
      details = payload.error.details ?? {};
    }
  } catch {
    /* non-JSON error body - keep the status-derived defaults */
  }
  if (code === 'UNKNOWN') {
    if (res.status === 401) code = 'UNAUTHORIZED';
    else if (res.status === 403) code = 'FORBIDDEN';
    else if (res.status === 404) code = 'NOT_FOUND';
    else if (res.status === 429) code = 'RATE_LIMITED';
    else if (res.status === 503) code = 'SERVICE_UNAVAILABLE';
  }
  return new ApiError({ code, status: res.status, messageEn, messageUr, requestId, details });
}

async function execute<T>(path: string, opts: RequestOptions, token: string | null): Promise<ApiResponse<T>> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };

  if (token && !opts.anonymous) headers.Authorization = `Bearer ${token}`;

  const actFor = bridge?.getActForCitizen() ?? null;
  if (actFor && !opts.anonymous && !('X-Act-For-Citizen' in headers)) {
    headers['X-Act-For-Citizen'] = actFor;
  }

  if (MUTATING.has(method) && !opts.anonymous) {
    headers['Idempotency-Key'] = opts.idempotencyKey ?? uuid();
  } else if (opts.idempotencyKey) {
    headers['Idempotency-Key'] = opts.idempotencyKey;
  }

  if (opts.ifNoneMatch) headers['If-None-Match'] = opts.ifNoneMatch;

  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.base ?? API_BASE), {
      method,
      headers,
      body,
      signal: opts.signal,
      credentials: 'same-origin',
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError({
      code: 'NETWORK_ERROR',
      status: 0,
      messageEn: 'No connection. Your work is saved and will be sent when the signal returns.',
      messageUr: 'انٹرنیٹ نہیں ہے۔ آپ کا کام محفوظ ہے اور سگنل آنے پر بھیج دیا جائے گا۔',
    });
  }

  const requestId = res.headers.get('X-Request-ID');
  const etag = res.headers.get('ETag');

  if (res.status === 304) {
    return { data: null, notModified: true, etag, status: 304, requestId };
  }

  if (!res.ok) throw await parseError(res);

  if (res.status === 204) {
    return { data: null, notModified: false, etag, status: 204, requestId };
  }

  const text = await res.text();
  const data = text ? (JSON.parse(text) as T) : null;
  return { data, notModified: false, etag, status: res.status, requestId };
}

/** Core request. Resolves with the envelope; throws `ApiError` on 4xx/5xx. */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  const token = opts.anonymous ? null : (bridge?.getAccessToken() ?? null);
  try {
    return await execute<T>(path, opts, token);
  } catch (err) {
    const retryable = err instanceof ApiError && err.status === 401 && !opts.noRetry && !opts.anonymous;
    if (!retryable) throw err;
    const fresh = await bridge?.refresh();
    if (!fresh) {
      bridge?.onUnauthorized();
      throw err;
    }
    return execute<T>(path, opts, fresh);
  }
}

/** Convenience: request and unwrap `data`, throwing when the body is empty. */
export async function requestData<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await request<T>(path, opts);
  if (res.data === null) {
    throw new ApiError({
      code: 'UNKNOWN',
      status: res.status,
      messageEn: 'Empty response from server.',
      messageUr: 'سرور سے خالی جواب ملا۔',
    });
  }
  return res.data;
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    requestData<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    requestData<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    requestData<T>(path, { ...opts, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    requestData<T>(path, { ...opts, method: 'PUT', body }),
  del: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    requestData<T>(path, { ...opts, method: 'DELETE' }),
  upload: <T>(path: string, form: FormData, opts?: Omit<RequestOptions, 'method' | 'form'>) =>
    requestData<T>(path, { ...opts, method: 'POST', form }),
};

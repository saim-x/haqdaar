import { audit, ctxFrom, db, delay, HttpError, save } from './core';
import { routes, smsInbox } from './handlers';
import { canonical, sha256 } from './util';

// Dev-only simulated backend: patches window.fetch for /api/v1/* and /mock/v1/*.
// Enabled with `npm run dev:mock` (VITE_MOCK_API=true). Implements the same
// contracts as docs/05 so the UI can be built and demoed before the API exists.
// Idempotency-Key replays return the cached response, like the real server.

const idem = new Map<string, { hash: string; status: number; body: unknown }>();

function json(status: number, body: unknown, extra: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-ID': `req_${Math.random().toString(16).slice(2, 10)}`, 'X-Simulated': 'dev-mock', ...extra },
  });
}

export function installDevMock() {
  const realFetch = window.fetch.bind(window);
  db();
  // Expose for debugging in the console.
  (window as unknown as { __haqdaarMock: unknown }).__haqdaarMock = { db, save };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
    const isApi = url.pathname.startsWith('/api/v1/');
    const isMock = url.pathname.startsWith('/mock/v1/');
    if (!isApi && !isMock) return realFetch(input, init);
    // Respect DevTools "Offline" so the outbox can be demonstrated.
    if (!navigator.onLine) throw new TypeError('Failed to fetch (offline)');

    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    await delay(120 + Math.random() * 180);

    if (isMock) {
      const m = url.pathname.match(/^\/mock\/v1\/sms\/inbox\/(.+)$/);
      if (m) return json(200, smsInbox(decodeURIComponent(m[1])));
      return json(404, { simulated: true, error: 'NOT_FOUND' });
    }

    const path = url.pathname.replace('/api/v1', '');
    const fileMatch = method === 'GET' && path.match(/^\/documents\/([^/]+)\/file$/);
    if (fileMatch) {
      const doc = db().documents.find((d) => d.id === fileMatch[1]);
      if (!doc?.data_url) return json(404, { error: { code: 'NOT_FOUND', message_en: 'Image is no longer in memory (dev mock keeps images per session).', message_ur: 'تصویر دستیاب نہیں۔' } });
      return realFetch(doc.data_url);
    }
    let body: unknown = null;
    let form: FormData | undefined;
    if (init?.body instanceof FormData) form = init.body;
    else if (typeof init?.body === 'string') body = JSON.parse(init.body);

    const ctx = ctxFrom(headers);
    const key = headers.get('Idempotency-Key');
    const reqHash = sha256(`${method}${path}${typeof init?.body === 'string' ? canonical(body) : form ? [...form.keys()].join(',') : ''}`);
    if (key) {
      const cached = idem.get(`${ctx.user?.id}:${key}`);
      if (cached) {
        if (cached.hash !== reqHash)
          return json(409, { error: { code: 'IDEMPOTENCY_CONFLICT', message_en: 'This request key was already used with different data.', message_ur: 'یہ درخواست پہلے مختلف معلومات کے ساتھ بھیجی گئی تھی۔' } });
        return json(cached.status, cached.body, { 'Idempotent-Replay': 'true' });
      }
    }

    for (const [m, re, handler] of routes) {
      if (m !== method) continue;
      const match = path.match(re);
      if (!match) continue;
      try {
        const out = await handler(ctx, { params: (match.groups ?? {}) as Record<string, string>, query: url.searchParams, body, form, headers });
        const status = method === 'POST' && /\/(cases|documents|consent\/grants|admin\/api-keys|admin\/users)$/.test(path) ? 201 : 200;
        if (key) idem.set(`${ctx.user?.id}:${key}`, { hash: reqHash, status, body: out });
        save();
        return json(status, out);
      } catch (e) {
        if (e instanceof HttpError) {
          return json(e.status, { error: { code: e.code, message_en: e.message, message_ur: e.ur, request_id: ctx.requestId, details: e.details } }, e.status === 429 ? { 'Retry-After': '600' } : {});
        }
        console.error('[dev-mock]', e);
        audit({ ctx, action: 'system.error', resource_type: 'endpoint', resource_id: path, payload: { message: String(e) } });
        return json(500, { error: { code: 'INTERNAL', message_en: 'Unexpected error in simulated backend.', message_ur: 'نقلی سرور میں خرابی۔', request_id: ctx.requestId } });
      }
    }
    return json(404, { error: { code: 'NOT_FOUND', message_en: `No simulated route for ${method} ${path}`, message_ur: 'نہیں ملا۔' } });
  };
  console.info('%c[Haqdaar] dev-mock backend active — all API calls are simulated in the browser.', 'color:#B45309;font-weight:bold');
}

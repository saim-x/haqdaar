import type { AuditEvent, Role } from '../api/types';
import { seed, STATE_VERSION, type MockState, type MUser } from './state';
import { canonical, id, now, sha256 } from './util';

// Persistence, auth context, errors and the hash-chained audit writer for the dev mock.

const KEY = 'hq.devmock.state';
let state: MockState | null = null;

export function db(): MockState {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MockState;
      if (parsed.version === STATE_VERSION) state = parsed;
    }
  } catch {
    /* corrupted: reseed */
  }
  if (!state) {
    state = seed();
    audit({ actor_type: 'SYSTEM', action: 'demo.seeded', resource_type: 'system', payload: { tenants: 2, programs: 2 } });
    save();
  }
  return state;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      // Document images are large; keep them out of localStorage.
      const s = { ...db(), documents: db().documents.map((d) => ({ ...d, data_url: undefined })) };
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* quota: keep in memory */
    }
  }, 50);
}

export function resetState() {
  state = seed();
  audit({ actor_type: 'SYSTEM', action: 'demo.reset', resource_type: 'system', payload: {} });
  save();
}

export class HttpError extends Error {
  status: number;
  code: string;
  ur: string;
  details?: Record<string, unknown>;
  constructor(status: number, code: string, en: string, ur: string, details?: Record<string, unknown>) {
    super(en);
    this.status = status;
    this.code = code;
    this.ur = ur;
    this.details = details;
  }
}

export const E = {
  unauthorized: () => new HttpError(401, 'UNAUTHORIZED', 'Please log in again.', 'براہ کرم دوبارہ لاگ ان کریں۔'),
  forbidden: () => new HttpError(403, 'FORBIDDEN', 'Your role cannot do this.', 'آپ کے کردار کو اس کی اجازت نہیں۔'),
  notFound: () => new HttpError(404, 'NOT_FOUND', 'Not found.', 'نہیں ملا۔'),
  consent: (category: string) =>
    new HttpError(403, 'CONSENT_REVOKED', 'Access blocked because the citizen withdrew consent for this data category.', 'شہری نے اس ڈیٹا تک رسائی کی اجازت واپس لے لی ہے۔', { category }),
  transition: (from: string, to: string) =>
    new HttpError(409, 'INVALID_TRANSITION', `Cannot move a case from ${from} to ${to}.`, 'یہ تبدیلی ممکن نہیں۔', { from, to }),
  validation: (fields: Record<string, string>) =>
    new HttpError(400, 'VALIDATION_ERROR', 'Some fields are missing or invalid.', 'کچھ معلومات غلط یا نامکمل ہیں۔', { fields }),
  unavailable: (service: string) =>
    new HttpError(503, 'SERVICE_UNAVAILABLE', `${service} is unavailable right now.`, 'سروس ابھی دستیاب نہیں۔', { service }),
};

export interface Ctx {
  user: MUser | null;
  actFor: string | null;
  requestId: string;
}

export function tokenFor(userId: string) {
  return `mock.${userId}.${Math.random().toString(36).slice(2, 10)}`;
}

export function ctxFrom(headers: Headers): Ctx {
  const auth = headers.get('Authorization') ?? '';
  const m = auth.match(/^Bearer mock\.([^.]+)\./);
  const user = m ? db().users.find((u) => u.id === m[1] && u.is_active) ?? null : null;
  return { user, actFor: headers.get('X-Act-For-Citizen'), requestId: `req_${Math.random().toString(16).slice(2, 10)}` };
}

export function requireRole(ctx: Ctx, ...roles: Role[]): MUser {
  if (!ctx.user) throw E.unauthorized();
  if (!roles.includes(ctx.user.role)) {
    audit({ ctx, action: 'auth.forbidden', resource_type: 'endpoint', payload: { role: ctx.user.role, allowed: roles } });
    throw E.forbidden();
  }
  return ctx.user;
}

export function audit(e: {
  ctx?: Ctx;
  actor_type?: AuditEvent['actor_type'];
  actor_id?: string | null;
  actor_role?: string | null;
  tenant_id?: string | null;
  action: string;
  resource_type: string;
  resource_id?: string | null;
  payload?: Record<string, unknown>;
}) {
  const s = state ?? db();
  const prev = s.audit[s.audit.length - 1];
  const seq = (prev?.seq ?? 0) + 1;
  const created_at = now();
  const payload = e.payload ?? {};
  const prev_hash = prev?.event_hash ?? 'GENESIS';
  const resource_id = e.resource_id ?? null;
  const event_hash = sha256([prev_hash, seq, created_at, e.action, e.resource_type, resource_id ?? '', canonical(payload)].join('|'));
  s.audit.push({
    seq,
    id: id('evt'),
    tenant_id: e.tenant_id ?? e.ctx?.user?.tenant_id ?? null,
    actor_type: e.actor_type ?? (e.ctx?.user ? 'USER' : 'SYSTEM'),
    actor_id: e.actor_id ?? e.ctx?.user?.id ?? null,
    actor_role: e.actor_role ?? e.ctx?.user?.role ?? null,
    action: e.action,
    resource_type: e.resource_type,
    resource_id,
    payload_json: payload,
    prev_hash,
    event_hash,
    created_at,
  });
  save();
}

export function verifyChain() {
  const ev = db().audit;
  let prev = 'GENESIS';
  for (const e of ev) {
    const h = sha256([prev, e.seq, e.created_at, e.action, e.resource_type, e.resource_id ?? '', canonical(e.payload_json)].join('|'));
    if (e.prev_hash !== prev || e.event_hash !== h) return { valid: false, checked_count: ev.length, first_broken_seq: e.seq };
    prev = e.event_hash;
  }
  return { valid: true, checked_count: ev.length, first_broken_seq: null };
}

export function page<T>(items: T[], q: URLSearchParams) {
  const limit = Math.min(100, Number(q.get('limit') ?? 20) || 20);
  const offset = Number(q.get('offset') ?? 0) || 0;
  return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
}

export const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

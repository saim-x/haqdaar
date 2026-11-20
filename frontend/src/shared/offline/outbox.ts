import { liveQuery } from 'dexie';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ApiError, request, uuid } from '../api/client';
import { db, type OutboxRow } from './db';

// Offline outbox (docs/11 §5.3). Every mutation is written to IndexedDB first with
// a UUID that doubles as the Idempotency-Key, then replayed in creation order.
// The server returns the cached response for replays, so a submission made
// offline lands exactly once no matter how many times it is retried.

const BACKOFF_MS = [2000, 5000, 15000, 30000];
type Result = { ok: true; data: unknown } | { ok: false; error: ApiError };
const waiters = new Map<string, (r: Result) => void>();
let flushing = false;
let timer: ReturnType<typeof setTimeout> | null = null;

// ---- online state ----
const onlineListeners = new Set<() => void>();
let online = typeof navigator === 'undefined' ? true : navigator.onLine;
function setOnline(v: boolean) {
  if (online === v) return;
  online = v;
  onlineListeners.forEach((l) => l());
  if (v) void flush();
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => setOnline(true));
  window.addEventListener('offline', () => setOnline(false));
}
export const useOnline = () =>
  useSyncExternalStore(
    (l) => {
      onlineListeners.add(l);
      return () => onlineListeners.delete(l);
    },
    () => online,
    () => true,
  );

// ---- syncing indicator ----
const syncListeners = new Set<() => void>();
let syncing = false;
function setSyncing(v: boolean) {
  syncing = v;
  syncListeners.forEach((l) => l());
}
export const useSyncing = () =>
  useSyncExternalStore(
    (l) => {
      syncListeners.add(l);
      return () => syncListeners.delete(l);
    },
    () => syncing,
    () => false,
  );

/** Resolve `{case:<localId>}` placeholders to the server case id once known. */
async function resolvePath(row: OutboxRow): Promise<string | null> {
  const m = row.path.match(/\{case:([^}]+)\}/);
  if (!m) return row.path;
  const draft = await db.drafts.get(m[1]);
  if (!draft?.serverCaseId) return null;
  return row.path.replace(m[0], draft.serverCaseId);
}

async function send(row: OutboxRow): Promise<unknown> {
  const path = await resolvePath(row);
  if (!path) throw new ApiError(0, 'WAITING_FOR_CASE', 'Waiting for case to be created', '', { network: true });

  let form: FormData | undefined;
  if (row.blob) {
    form = new FormData();
    form.append('file', row.blob, 'document.jpg');
    for (const [k, v] of Object.entries(row.form ?? {})) {
      const caseMatch = v.match(/^\{case:([^}]+)\}$/);
      if (caseMatch) {
        const d = await db.drafts.get(caseMatch[1]);
        if (d?.serverCaseId) form.append(k, d.serverCaseId);
      } else form.append(k, v);
    }
  }
  return request(path, {
    method: row.method,
    body: form ? undefined : row.body,
    form,
    idempotencyKey: row.id,
    actFor: row.actForCitizenId,
    timeoutMs: row.blob ? 30000 : 15000,
  });
}

async function afterSuccess(row: OutboxRow, data: unknown) {
  if (row.kind === 'CREATE_CASE' && row.localCaseId) {
    const id = (data as { id?: string })?.id;
    if (id) await db.drafts.update(row.localCaseId, { serverCaseId: id });
  }
  await db.outbox.delete(row.id);
}

export async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  setSyncing(true);
  try {
    // Strict creation order: a draft save must never overtake its case creation.
    const rows = await db.outbox.orderBy('createdAt').toArray();
    for (const row of rows) {
      if (row.status === 'FAILED') continue;
      if (row.nextAttemptAt > Date.now() && !waiters.has(row.id)) {
        schedule(row.nextAttemptAt - Date.now());
        break;
      }
      await db.outbox.update(row.id, { status: 'SYNCING' });
      try {
        const data = await send(row);
        await afterSuccess(row, data);
        waiters.get(row.id)?.({ ok: true, data });
        waiters.delete(row.id);
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', String(e), '', { network: true });
        const retryable = err.network || err.status >= 500 || err.status === 429;
        if (retryable) {
          const attempts = row.attempts + 1;
          const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
          await db.outbox.update(row.id, {
            status: 'PENDING',
            attempts,
            nextAttemptAt: Date.now() + delay,
            lastError: err.message,
            lastErrorUr: err.messageUr,
          });
          waiters.get(row.id)?.({ ok: false, error: err });
          waiters.delete(row.id);
          if (err.network) setOnline(navigator.onLine);
          schedule(delay);
          break; // keep order: stop at the first item that could not be sent
        }
        // 4xx: needs human attention, do not retry blindly.
        await db.outbox.update(row.id, { status: 'FAILED', lastError: err.message, lastErrorUr: err.messageUr });
        waiters.get(row.id)?.({ ok: false, error: err });
        waiters.delete(row.id);
      }
    }
  } finally {
    flushing = false;
    setSyncing(false);
  }
}

function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, Math.max(ms, 500));
}

export interface EnqueueInput {
  kind: OutboxRow['kind'];
  method: OutboxRow['method'];
  path: string;
  body?: unknown;
  blob?: Blob;
  form?: Record<string, string>;
  citizenId: string;
  actForCitizenId: string | null;
  localCaseId?: string;
}

export type SendOutcome<T> = { status: 'sent'; data: T } | { status: 'queued' } | { status: 'failed'; error: ApiError };

/**
 * Persist the mutation, then try to send it right away. Resolves with the server
 * response when online, or `queued` when the device is offline / the server is
 * unreachable (the outbox keeps retrying in the background).
 */
export async function sendOrQueue<T>(input: EnqueueInput, waitMs = 12000): Promise<SendOutcome<T>> {
  const row: OutboxRow = {
    id: uuid(),
    createdAt: Date.now(),
    status: 'PENDING',
    attempts: 0,
    nextAttemptAt: 0,
    ...input,
  };
  await db.outbox.put(row);
  if (!online) return { status: 'queued' };

  const result = await new Promise<Result | null>((resolve) => {
    const t = setTimeout(() => {
      waiters.delete(row.id);
      resolve(null);
    }, waitMs);
    waiters.set(row.id, (r) => {
      clearTimeout(t);
      resolve(r);
    });
    void flush();
  });
  if (!result) return { status: 'queued' };
  if (result.ok) return { status: 'sent', data: result.data as T };
  if (result.error.network || result.error.status >= 500 || result.error.status === 429) return { status: 'queued' };
  return { status: 'failed', error: result.error };
}

export async function retryFailed(id?: string) {
  const rows = id ? [await db.outbox.get(id)] : await db.outbox.where('status').equals('FAILED').toArray();
  for (const r of rows) if (r) await db.outbox.update(r.id, { status: 'PENDING', nextAttemptAt: 0 });
  await flush();
}

export async function discard(id: string) {
  await db.outbox.delete(id);
}

export function useOutbox(): { pending: number; failed: OutboxRow[] } {
  const [state, setState] = useState<{ pending: number; failed: OutboxRow[] }>({ pending: 0, failed: [] });
  useEffect(() => {
    const sub = liveQuery(() => db.outbox.toArray()).subscribe({
      next: (rows) =>
        setState({
          pending: rows.filter((r) => r.status !== 'FAILED').length,
          failed: rows.filter((r) => r.status === 'FAILED'),
        }),
      error: () => undefined,
    });
    return () => sub.unsubscribe();
  }, []);
  return state;
}

// Kick the outbox on load and whenever the tab becomes visible again.
if (typeof window !== 'undefined') {
  setTimeout(() => void flush(), 1500);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flush();
  });
}

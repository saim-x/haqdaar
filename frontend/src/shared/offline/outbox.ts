import { OUTBOX_BACKOFF_MS } from '../config';
import { request } from '../api/client';
import { ApiError } from '../api/errors';
import { uuid } from '../lib/uuid';
import { db, type OutboxRow } from './db';

/**
 * Outbox sync engine — docs/11 §5.3.
 *
 *   OfflineAction -> QueuedInOutbox  (persist with Idempotency-Key UUID)
 *   QueuedInOutbox -> Syncing        (window 'online' event or manual Retry)
 *   Syncing -> Done                  (2xx or idempotent replay) -> delete + invalidate
 *   Syncing -> QueuedInOutbox        (network error / 5xx) -> backoff 2/5/15/30 s
 *   Syncing -> NeedsAttention        (4xx that is not a replay) -> Urdu error card
 *
 * Rows are drained strictly oldest-first so a draft PATCH can never overtake the
 * POST /cases that created the case it patches.
 */

export interface OutboxState {
  online: boolean;
  pending: number;
  syncing: boolean;
  needsAttention: OutboxRow[];
  lastSyncedAt: number | null;
}

type Listener = (state: OutboxState) => void;

const listeners = new Set<Listener>();
let state: OutboxState = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  pending: 0,
  syncing: false,
  needsAttention: [],
  lastSyncedAt: null,
};

let draining = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let onSynced: (() => void) | null = null;

function emit(): void {
  for (const fn of listeners) fn(state);
}

export function subscribeOutbox(fn: Listener): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export function getOutboxState(): OutboxState {
  return state;
}

/** Called by the provider so a successful drain can invalidate React Query caches. */
export function setOutboxSyncListener(fn: (() => void) | null): void {
  onSynced = fn;
}

async function refreshCounts(): Promise<void> {
  const [pending, failed] = await Promise.all([
    db.outbox.where('status').anyOf('PENDING', 'SYNCING').count(),
    db.outbox.where('status').equals('FAILED').toArray(),
  ]);
  state = { ...state, pending, needsAttention: failed };
  emit();
}

export interface EnqueueInput {
  method: OutboxRow['method'];
  path: string;
  body?: unknown;
  blob?: Blob | null;
  blobField?: string | null;
  formFields?: Record<string, string> | null;
  citizenId: string | null;
  actForCitizenId: string | null;
  label: string;
  /** Reuse an existing key when retrying the same logical action. */
  idempotencyKey?: string;
}

export async function enqueue(input: EnqueueInput): Promise<OutboxRow> {
  const id = input.idempotencyKey ?? uuid();
  const row: OutboxRow = {
    id,
    createdAt: Date.now(),
    citizenId: input.citizenId,
    actForCitizenId: input.actForCitizenId,
    method: input.method,
    path: input.path,
    body: input.body ?? null,
    blobRef: input.blob ? id : null,
    blob: input.blob ?? null,
    blobField: input.blobField ?? null,
    formFields: input.formFields ?? null,
    status: 'PENDING',
    attempts: 0,
    lastError: null,
    lastErrorCode: null,
    nextAttemptAt: Date.now(),
    label: input.label,
  };
  await db.outbox.put(row);
  await refreshCounts();
  scheduleDrain(0);
  return row;
}

export async function retryRow(id: string): Promise<void> {
  await db.outbox.update(id, { status: 'PENDING', nextAttemptAt: Date.now(), lastError: null, lastErrorCode: null });
  await refreshCounts();
  scheduleDrain(0);
}

export async function discardRow(id: string): Promise<void> {
  await db.outbox.delete(id);
  await refreshCounts();
}

function scheduleDrain(delayMs: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void drain();
  }, delayMs);
}

function backoffFor(attempts: number): number {
  const idx = Math.min(Math.max(attempts - 1, 0), OUTBOX_BACKOFF_MS.length - 1);
  return OUTBOX_BACKOFF_MS[idx] ?? 30_000;
}

/** Drain the queue. Safe to call concurrently — only one drain runs at a time. */
export async function drain(): Promise<void> {
  if (draining) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    state = { ...state, online: false };
    emit();
    return;
  }
  draining = true;
  state = { ...state, syncing: true, online: true };
  emit();

  let syncedAny = false;
  try {
    for (;;) {
      const now = Date.now();
      const rows = await db.outbox.orderBy('createdAt').toArray();
      const next = rows.find((r) => r.status !== 'FAILED' && r.nextAttemptAt <= now);
      if (!next) break;

      await db.outbox.update(next.id, { status: 'SYNCING' });
      try {
        if (next.blob && next.blobField) {
          const form = new FormData();
          form.append(next.blobField, next.blob, `${next.id}.jpg`);
          for (const [k, v] of Object.entries(next.formFields ?? {})) form.append(k, v);
          await request(next.path, {
            method: next.method,
            form,
            idempotencyKey: next.id,
            headers: next.actForCitizenId ? { 'X-Act-For-Citizen': next.actForCitizenId } : undefined,
          });
        } else {
          await request(next.path, {
            method: next.method,
            body: next.body ?? undefined,
            idempotencyKey: next.id,
            headers: next.actForCitizenId ? { 'X-Act-For-Citizen': next.actForCitizenId } : undefined,
          });
        }
        await db.outbox.delete(next.id);
        syncedAny = true;
      } catch (err) {
        const attempts = next.attempts + 1;
        if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429) {
          // A real rejection: retrying will not help. Surface it to the citizen.
          await db.outbox.update(next.id, {
            status: 'FAILED',
            attempts,
            lastError: err.messageEn,
            lastErrorCode: err.code,
          });
        } else {
          await db.outbox.update(next.id, {
            status: 'PENDING',
            attempts,
            lastError: err instanceof ApiError ? err.messageEn : String(err),
            lastErrorCode: err instanceof ApiError ? err.code : 'UNKNOWN',
            nextAttemptAt: Date.now() + backoffFor(attempts),
          });
          // Network is down or the server is unhappy: stop this pass and wait.
          break;
        }
      }
      await refreshCounts();
    }
  } finally {
    draining = false;
    state = { ...state, syncing: false, lastSyncedAt: syncedAny ? Date.now() : state.lastSyncedAt };
    await refreshCounts();
    if (syncedAny) onSynced?.();

    // If anything is still waiting on a backoff timer, come back for it.
    const rows = await db.outbox.toArray();
    const waiting = rows.filter((r) => r.status === 'PENDING');
    if (waiting.length > 0) {
      const soonest = Math.min(...waiting.map((r) => r.nextAttemptAt));
      scheduleDrain(Math.max(soonest - Date.now(), 250));
    }
  }
}

/** Wire browser connectivity events. Returns a teardown function. */
export function installOutboxListeners(): () => void {
  const goOnline = () => {
    state = { ...state, online: true };
    emit();
    scheduleDrain(0);
  };
  const goOffline = () => {
    state = { ...state, online: false };
    emit();
  };
  window.addEventListener('online', goOnline);
  window.addEventListener('offline', goOffline);
  void refreshCounts().then(() => scheduleDrain(0));
  return () => {
    window.removeEventListener('online', goOnline);
    window.removeEventListener('offline', goOffline);
    if (timer) clearTimeout(timer);
  };
}

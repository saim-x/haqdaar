/**
 * Session store — the single source of truth for "who is signed in" and
 * "who is the helper acting for".
 *
 * Kept outside React so the API client can read tokens synchronously, and
 * exposed to React through `useSyncExternalStore`.
 */
import { STORAGE_KEYS } from '../config';
import type { Citizen, Role, Tenant, User } from '../api/types';

export interface ActFor {
  citizenId: string;
  fullName: string;
  avatarColor: string;
  district: string | null;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token stops being usable; null when unknown. */
  expiresAt: number | null;
  user: User;
  citizen: Citizen | null;
  tenant: Tenant | null;
}

export type AuthStatus = 'loading' | 'anon' | 'authed';

interface Persisted {
  session: Session | null;
  actFor: ActFor | null;
}

function readPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.auth);
    if (!raw) return { session: null, actFor: null };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return { session: parsed.session ?? null, actFor: parsed.actFor ?? null };
  } catch {
    return { session: null, actFor: null };
  }
}

const initial = readPersisted();

let session: Session | null = initial.session;
let actFor: ActFor | null = initial.actFor;
let status: AuthStatus = session ? 'authed' : 'anon';

const listeners = new Set<() => void>();

/**
 * `useSyncExternalStore` compares snapshots by reference, so the snapshot object
 * must be stable between mutations. Rebuilding it on every `getSnapshot()` call
 * would re-render forever.
 */
let snapshot: { session: Session | null; actFor: ActFor | null; status: AuthStatus } = {
  session,
  actFor,
  status,
};

function emit(): void {
  snapshot = { session, actFor, status };
  for (const fn of listeners) fn();
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEYS.auth, JSON.stringify({ session, actFor } satisfies Persisted));
  } catch {
    /* storage full or blocked — session stays in memory for this tab */
  }
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSnapshot(): { session: Session | null; actFor: ActFor | null; status: AuthStatus } {
  return snapshot;
}

export function getSession(): Session | null {
  return session;
}

export function getActFor(): ActFor | null {
  return actFor;
}

export function getAccessToken(): string | null {
  return session?.accessToken ?? null;
}

export function getRole(): Role | null {
  return session?.user.role ?? null;
}

export function setSession(next: Session | null): void {
  session = next;
  status = next ? 'authed' : 'anon';
  if (!next) actFor = null;
  persist();
  emit();
}

export function setActFor(next: ActFor | null): void {
  actFor = next;
  persist();
  emit();
}

export function setStatus(next: AuthStatus): void {
  status = next;
  emit();
}

/** The citizen whose data the current request is about. */
export function effectiveCitizenId(): string | null {
  return actFor?.citizenId ?? session?.citizen?.id ?? null;
}

export function isHelperActing(): boolean {
  return session?.user.role === 'HELPER' && actFor !== null;
}

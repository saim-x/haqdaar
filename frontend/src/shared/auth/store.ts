import { useSyncExternalStore } from 'react';
import type { Role, Tenant, User } from '../api/types';

// Tiny persisted store (no extra dependency keeps the citizen bundle small).
// The server is the only authority on role/tenant/consent; this is display state.

export interface ActingFor {
  citizenId: string;
  name: string;
  avatarColor: string;
}

export interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  citizenId: string | null;
  tenant: Tenant | null;
  actingFor: ActingFor | null;
}

const KEY = 'hq.auth.v1';
const empty: AuthState = {
  accessToken: null,
  refreshToken: null,
  user: null,
  citizenId: null,
  tenant: null,
  actingFor: null,
};

function load(): AuthState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...empty, ...(JSON.parse(raw) as Partial<AuthState>) } : empty;
  } catch {
    return empty;
  }
}

let state: AuthState = load();
const listeners = new Set<() => void>();

function emit() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked: keep in-memory state */
  }
  listeners.forEach((l) => l());
}

export const authStore = {
  get: () => state,
  set(patch: Partial<AuthState>) {
    state = { ...state, ...patch };
    emit();
  },
  clear() {
    state = empty;
    emit();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useAuth(): AuthState {
  return useSyncExternalStore(authStore.subscribe, authStore.get, authStore.get);
}

export function homePathFor(role: Role | undefined): string {
  switch (role) {
    case 'CITIZEN':
      return '/c';
    case 'HELPER':
      return '/h';
    case 'OFFICER':
      return '/staff/queue';
    case 'ADMIN':
      return '/admin/rules';
    case 'AUDITOR':
      return '/auditor/events';
    default:
      return '/login';
  }
}

import { useSyncExternalStore } from 'react';

// Device-level preferences (not account data).
export interface Settings {
  liteMode: boolean;
  autoRead: boolean;
  /** true once the user flips lite mode by hand; stops auto-detection overriding them. */
  liteModeManual: boolean;
}

const KEY = 'hq.settings.v1';

interface NetInfo {
  saveData?: boolean;
  effectiveType?: string;
}

function detectSlow(): boolean {
  const c = (navigator as Navigator & { connection?: NetInfo }).connection;
  return !!c && (c.saveData === true || c.effectiveType === '2g' || c.effectiveType === 'slow-2g');
}

let state: Settings = (() => {
  const base: Settings = { liteMode: false, autoRead: true, liteModeManual: false };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Settings>;
    const merged = { ...base, ...saved };
    if (!merged.liteModeManual) merged.liteMode = detectSlow();
    return merged;
  } catch {
    return base;
  }
})();

const listeners = new Set<() => void>();

export const settingsStore = {
  get: () => state,
  set(patch: Partial<Settings>) {
    state = { ...state, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export const useSettings = () => useSyncExternalStore(settingsStore.subscribe, settingsStore.get, settingsStore.get);

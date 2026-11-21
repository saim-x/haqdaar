import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { LITE_AUTO_TYPES, STORAGE_KEYS } from '../config';

/**
 * Lite Mode - docs/11 §2.7.
 * Auto-enables on `navigator.connection.saveData` or a 2g/slow-2g effective type,
 * and can always be toggled by hand. When on, decorative art is dropped and
 * non-essential polling is disabled.
 */
interface LiteModeContextValue {
  lite: boolean;
  /** True when the browser asked for it (saveData / 2g) rather than the user. */
  auto: boolean;
  setLite(next: boolean): void;
  toggle(): void;
  saveData: boolean;
  effectiveType: string | null;
}

const LiteModeContext = createContext<LiteModeContextValue | null>(null);

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

function connection(): NetworkInformationLike | null {
  const nav = navigator as Navigator & { connection?: NetworkInformationLike };
  return nav.connection ?? null;
}

function detectAuto(): { auto: boolean; saveData: boolean; effectiveType: string | null } {
  const conn = connection();
  const saveData = conn?.saveData === true;
  const effectiveType = conn?.effectiveType ?? null;
  const slow = effectiveType !== null && LITE_AUTO_TYPES.includes(effectiveType);
  return { auto: saveData || slow, saveData, effectiveType };
}

function readOverride(): boolean | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.lite);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    /* ignore */
  }
  return null;
}

export function LiteModeProvider({ children }: { children: ReactNode }) {
  const [net, setNet] = useState(detectAuto);
  const [override, setOverride] = useState<boolean | null>(readOverride);

  useEffect(() => {
    const conn = connection();
    if (!conn?.addEventListener) return;
    const onChange = () => setNet(detectAuto());
    conn.addEventListener('change', onChange);
    return () => conn.removeEventListener?.('change', onChange);
  }, []);

  const setLite = useCallback((next: boolean) => {
    setOverride(next);
    try {
      localStorage.setItem(STORAGE_KEYS.lite, String(next));
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<LiteModeContextValue>(() => {
    const lite = override ?? net.auto;
    return {
      lite,
      auto: net.auto,
      setLite,
      toggle: () => setLite(!lite),
      saveData: net.saveData,
      effectiveType: net.effectiveType,
    };
  }, [override, net, setLite]);

  return <LiteModeContext.Provider value={value}>{children}</LiteModeContext.Provider>;
}

export function useLiteMode(): LiteModeContextValue {
  const ctx = useContext(LiteModeContext);
  if (!ctx) throw new Error('useLiteMode must be used inside <LiteModeProvider>');
  return ctx;
}

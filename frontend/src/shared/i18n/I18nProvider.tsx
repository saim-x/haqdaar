import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { STORAGE_KEYS } from '../config';
import { en, ur, type DictKey } from './dictionary';

export type Lang = 'ur' | 'sd' | 'en';

interface I18nContextValue {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  isRtl: boolean;
  setLang(next: Lang): void;
  toggleLang(): void;
  t(key: DictKey): string;
  /** Pick the right field from a bilingual API object. */
  pick(urValue: string | null | undefined, enValue: string | null | undefined): string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

let cachedSd: Partial<Record<DictKey, string>> | null = null;

function readLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.lang);
    if (stored === 'ur' || stored === 'sd' || stored === 'en') return stored;
  } catch {
    /* private mode */
  }
  return 'ur';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang);
  const [sdDict, setSdDict] = useState<Partial<Record<DictKey, string>> | null>(cachedSd);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = lang === 'en' ? 'ltr' : 'rtl';
    try {
      localStorage.setItem(STORAGE_KEYS.lang, lang);
    } catch {
      /* ignore */
    }
    if (lang === 'sd' && !cachedSd) {
      void import('./sindhi').then((mod) => {
        cachedSd = mod.sd;
        setSdDict(mod.sd);
      });
    }
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    // Update synchronously so localized staff copy rerenders in the newly
    // selected language before React's persistence effect runs.
    document.documentElement.lang = next;
    document.documentElement.dir = next === 'en' ? 'ltr' : 'rtl';
    setLangState(next);
  }, []);
  const toggleLang = useCallback(
    () => setLangState((prev) => (prev === 'ur' ? 'sd' : prev === 'sd' ? 'en' : 'ur')),
    [],
  );

  const value = useMemo<I18nContextValue>(() => {
    const isRtl = lang !== 'en';
    return {
      lang,
      dir: isRtl ? 'rtl' : 'ltr',
      isRtl,
      setLang,
      toggleLang,
      t: (key: DictKey) => {
        if (lang === 'en') return en[key] ?? ur[key] ?? key;
        if (lang === 'sd') return sdDict?.[key] ?? ur[key] ?? key;
        return ur[key] ?? key;
      },
      pick: (urValue, enValue) => {
        const primary = isRtl ? urValue : enValue;
        const fallback = isRtl ? enValue : urValue;
        return primary || fallback || '';
      },
    };
  }, [lang, sdDict, setLang, toggleLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

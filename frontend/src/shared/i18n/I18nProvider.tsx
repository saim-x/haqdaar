import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { STORAGE_KEYS } from '../config';
import { en, ur, type DictKey } from './dictionary';

export type Lang = 'ur' | 'en';

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

function readLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.lang);
    if (stored === 'ur' || stored === 'en') return stored;
  } catch {
    /* private mode */
  }
  return 'ur';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = lang === 'ur' ? 'rtl' : 'ltr';
    try {
      localStorage.setItem(STORAGE_KEYS.lang, lang);
    } catch {
      /* ignore */
    }
  }, [lang]);

  const setLang = useCallback((next: Lang) => setLangState(next), []);
  const toggleLang = useCallback(() => setLangState((prev) => (prev === 'ur' ? 'en' : 'ur')), []);

  const value = useMemo<I18nContextValue>(() => {
    const dict = lang === 'ur' ? ur : en;
    return {
      lang,
      dir: lang === 'ur' ? 'rtl' : 'ltr',
      isRtl: lang === 'ur',
      setLang,
      toggleLang,
      t: (key: DictKey) => dict[key] ?? ur[key] ?? key,
      pick: (urValue, enValue) => {
        const primary = lang === 'ur' ? urValue : enValue;
        const fallback = lang === 'ur' ? enValue : urValue;
        return primary || fallback || '';
      },
    };
  }, [lang, setLang, toggleLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

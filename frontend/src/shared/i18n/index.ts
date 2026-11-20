import { useSyncExternalStore } from 'react';
import { dict, type DictKey } from './dict';

export type Lang = 'ur' | 'en';
const KEY = 'hq.lang';

let lang: Lang = (() => {
  try {
    return (localStorage.getItem(KEY) as Lang) || 'ur';
  } catch {
    return 'ur';
  }
})();
const listeners = new Set<() => void>();

export function applyDocumentLang(l: Lang) {
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'ur' ? 'rtl' : 'ltr';
}

export const langStore = {
  get: () => lang,
  set(l: Lang) {
    lang = l;
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* ignore */
    }
    listeners.forEach((fn) => fn());
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export function useLang(): Lang {
  return useSyncExternalStore(langStore.subscribe, langStore.get, langStore.get);
}

export function translate(l: Lang, key: DictKey, vars?: Record<string, string | number>): string {
  let s: string = dict[key][l];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

/** Returns a translator bound to the current language plus a bilingual picker. */
export function useT() {
  const l = useLang();
  const t = (key: DictKey, vars?: Record<string, string | number>) => translate(l, key, vars);
  const pick = (ur: string | null | undefined, en: string | null | undefined) => (l === 'ur' ? ur || en : en || ur) ?? '';
  return { t, lang: l, pick };
}

const nf = { ur: new Intl.NumberFormat('en-PK'), en: new Intl.NumberFormat('en-PK') };
export const formatPkr = (n: number | null | undefined, l: Lang = lang) =>
  n === null || n === undefined ? '—' : l === 'ur' ? `${nf.ur.format(n)} روپے` : `PKR ${nf.en.format(n)}`;

export function formatDateTime(iso: string | null | undefined, l: Lang = lang): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(l === 'ur' ? 'ur-PK' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export type { DictKey };

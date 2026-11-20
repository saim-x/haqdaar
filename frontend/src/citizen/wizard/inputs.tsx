import { Delete, Minus, Plus } from 'lucide-react';
import { useT } from '../../shared/i18n';
import { cx } from '../../shared/ui/cx';

/** Large visual 0–9 keypad. Digits are LTR even in Urdu UI. */
export function Keypad({ onDigit, onBackspace, disabled }: { onDigit: (d: string) => void; onBackspace: () => void; disabled?: boolean }) {
  const { lang } = useT();
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const btn =
    'num min-h-[62px] rounded-2xl border-2 border-b-[5px] border-line bg-surface text-2xl font-bold transition-[transform,border-width] duration-fast hover:border-line-strong/40 active:translate-y-[3px] active:border-b-2 disabled:opacity-50';
  return (
    <div className="grid grid-cols-3 gap-2" dir="ltr">
      {keys.map((k) => (
        <button key={k} type="button" className={btn} onClick={() => onDigit(k)} disabled={disabled}>
          {k}
        </button>
      ))}
      <span aria-hidden />
      <button type="button" className={btn} onClick={() => onDigit('0')} disabled={disabled}>
        0
      </button>
      <button
        type="button"
        className={cx(btn, 'inline-flex items-center justify-center text-muted')}
        onClick={onBackspace}
        aria-label={lang === 'ur' ? 'آخری ہندسہ مٹائیں' : 'Delete last digit'}
      >
        <Delete className="h-7 w-7" aria-hidden />
      </button>
    </div>
  );
}

/** Giant – [ n ] + counter (docs/11 §3.2 steps 8–9). */
export function Counter({ value, onChange, min = 0, max = 30 }: { value: number | null; onChange: (n: number) => void; min?: number; max?: number }) {
  const { lang } = useT();
  const v = value ?? min;
  const btn =
    'inline-flex h-20 w-20 items-center justify-center rounded-full border-2 border-b-[6px] border-line bg-surface text-brand transition-[transform,border-width] duration-fast active:translate-y-[3px] active:border-b-2 disabled:opacity-40';
  return (
    <div className="flex items-center justify-center gap-5" dir="ltr">
      <button type="button" className={btn} onClick={() => onChange(Math.max(min, v - 1))} disabled={v <= min} aria-label={lang === 'ur' ? 'ایک کم' : 'One less'}>
        <Minus className="h-9 w-9" aria-hidden />
      </button>
      <output aria-live="polite" className="num min-w-[110px] rounded-3xl bg-brand-soft py-2 text-center text-7xl font-bold tabular-nums text-brand">
        {value === null ? '–' : v}
      </output>
      <button type="button" className={btn} onClick={() => onChange(Math.min(max, v + 1))} disabled={v >= max} aria-label={lang === 'ur' ? 'ایک زیادہ' : 'One more'}>
        <Plus className="h-9 w-9" aria-hidden />
      </button>
    </div>
  );
}

/** Pictorial head-count row so the number is visible without reading. */
export function PeopleDots({ n, max = 12 }: { n: number; max?: number }) {
  const shown = Math.min(n, max);
  return (
    <div className="flex flex-wrap justify-center gap-1.5" aria-hidden>
      {Array.from({ length: shown }).map((_, i) => (
        <svg key={i} viewBox="0 0 24 24" className="h-7 w-7 text-brand">
          <circle cx="12" cy="7" r="4" fill="currentColor" />
          <path d="M4 22c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="currentColor" />
        </svg>
      ))}
      {n > max && <span className="self-center text-lg font-bold text-brand">+{n - max}</span>}
    </div>
  );
}

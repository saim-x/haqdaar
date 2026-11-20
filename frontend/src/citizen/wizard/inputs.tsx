import { useMemo } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider';
import { AudioButton } from '../../shared/ui/AudioButton';
import { IconArrowLeft, IconCheck, IconCross, IconMinus, IconPlus, IconQuestion } from '../../shared/ui/Icons';
import { SINDH_DISTRICTS, districtLabel } from '../../shared/lib/districts';
import { formatCnic } from '../../shared/lib/cnic';

/* ------------------------------------------------------------------ keypad */

interface DigitPadProps {
  value: string;
  onChange(next: string): void;
  maxDigits: number;
  format?(digits: string): string;
  /** Renders the prominent "I don't know" escape hatch (docs/11 §3.2 step 6). */
  onUnknown?: () => void;
  unknown?: boolean;
  audioKey?: string;
  audioText?: string;
}

/**
 * Large 0–9 visual keypad. Digits are 64 px tall so a woman who has never used
 * a smartphone can still hit them; the formatted value is read-only above.
 */
export function DigitPad({
  value,
  onChange,
  maxDigits,
  format,
  onUnknown,
  unknown,
  audioKey,
  audioText,
}: DigitPadProps) {
  const { t } = useI18n();
  const display = format ? format(value) : value;

  function press(digit: string) {
    if (value.length >= maxDigits) return;
    onChange(value + digit);
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 rounded-2xl border-2 border-ink/15 bg-white px-4 py-3">
        <output
          aria-live="polite"
          className="num min-h-8 flex-1 text-2xl font-bold tracking-wider text-ink"
          dir="ltr"
        >
          {display || <span className="text-ink/25">—</span>}
        </output>
        <AudioButton audioKey={audioKey} text={audioText} />
      </div>

      <div className="grid grid-cols-3 gap-2" data-testid="digit-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <button
            key={digit}
            type="button"
            onClick={() => press(digit)}
            className="num min-h-primary rounded-2xl border-2 border-ink/15 bg-white text-2xl font-bold text-ink active:bg-teal-50"
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange(value.slice(0, -1))}
          aria-label={t('common.back')}
          className="grid min-h-primary place-items-center rounded-2xl border-2 border-ink/15 bg-ink/5 text-ink active:bg-ink/10"
        >
          <IconArrowLeft size={24} className="rtl:rotate-180" />
        </button>
        <button
          type="button"
          onClick={() => press('0')}
          className="num min-h-primary rounded-2xl border-2 border-ink/15 bg-white text-2xl font-bold text-ink active:bg-teal-50"
        >
          0
        </button>
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={t('common.cancel')}
          className="grid min-h-primary place-items-center rounded-2xl border-2 border-ink/15 bg-ink/5 text-ink active:bg-ink/10"
        >
          <IconCross size={22} />
        </button>
      </div>

      {onUnknown && (
        <button
          type="button"
          onClick={onUnknown}
          aria-pressed={unknown}
          className={`mt-3 flex min-h-primary w-full items-center justify-center gap-2 rounded-2xl border-2 text-base font-bold ${
            unknown ? 'border-amber-500 bg-amber-100 text-[#3B2A00]' : 'border-amber-500 bg-white text-[#8A5A00]'
          }`}
        >
          <IconQuestion size={22} />
          {t('common.dontKnow')}
        </button>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- counter */

interface CounterProps {
  value: number;
  onChange(next: number): void;
  min?: number;
  max?: number;
  audioKey?: string;
  audioText?: string;
}

/** Giant − [ n ] + counter (docs/11 §3.2 steps 8–9). */
export function Counter({ value, onChange, min = 0, max = 20, audioKey, audioText }: CounterProps) {
  const { lang } = useI18n();
  const lessLabel = lang === 'ur' ? 'ایک کم کریں' : 'One less';
  const moreLabel = lang === 'ur' ? 'ایک زیادہ کریں' : 'One more';
  return (
    <div className="flex items-center justify-center gap-3">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={lessLabel}
        className="grid h-20 w-20 place-items-center rounded-3xl border-2 border-ink/15 bg-white text-ink active:bg-teal-50 disabled:opacity-40"
      >
        <IconMinus size={34} />
      </button>
      <output
        aria-live="polite"
        className="num grid h-20 min-w-24 place-items-center rounded-3xl border-2 border-teal-600 bg-teal-50 px-4 text-4xl font-bold text-teal-800"
      >
        {value}
      </output>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={moreLabel}
        className="grid h-20 w-20 place-items-center rounded-3xl border-2 border-ink/15 bg-white text-ink active:bg-teal-50 disabled:opacity-40"
      >
        <IconPlus size={34} />
      </button>
      <AudioButton audioKey={audioKey} text={audioText} size="lg" />
    </div>
  );
}

/* ------------------------------------------------------------------ income */

export const INCOME_BANDS = [
  { key: 'wizard.income.band1', value: 15000 },
  { key: 'wizard.income.band2', value: 25000 },
  { key: 'wizard.income.band3', value: 35000 },
  { key: 'wizard.income.band4', value: 50000 },
] as const;

interface IncomeProps {
  value: number | null;
  onChange(next: number | null): void;
  exact: boolean;
  onExactChange(next: boolean): void;
  exactDigits: string;
  onExactDigits(next: string): void;
}

/** Tap bands or an exact keypad amount (docs/11 §3.2 step 10). */
export function IncomeBands({ value, onChange, exact, onExactChange, exactDigits, onExactDigits }: IncomeProps) {
  const { t } = useI18n();
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {INCOME_BANDS.map((band) => {
          const selected = !exact && value === band.value;
          return (
            <button
              key={band.key}
              type="button"
              onClick={() => {
                onExactChange(false);
                onChange(band.value);
              }}
              aria-pressed={selected}
              className={`num flex min-h-primary items-center justify-center rounded-2xl border-2 px-2 text-sm font-bold ${
                selected ? 'border-teal-700 bg-teal-600 text-white' : 'border-ink/15 bg-white text-ink'
              }`}
            >
              {t(band.key)}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => onExactChange(!exact)}
        aria-pressed={exact}
        className={`mt-2 min-h-tap w-full rounded-2xl border-2 text-sm font-bold ${
          exact ? 'border-teal-700 bg-teal-50 text-teal-800' : 'border-ink/15 bg-white text-ink-soft'
        }`}
      >
        {t('wizard.income.exact')}
      </button>

      {exact && (
        <div className="mt-2">
          <DigitPad
            value={exactDigits}
            onChange={(next) => {
              onExactDigits(next);
              onChange(next ? Number(next) : null);
            }}
            maxDigits={6}
            format={(digits) => (digits ? Number(digits).toLocaleString('en-PK') : '')}
            audioKey="wizard_income"
            audioText={t('wizard.income.title')}
          />
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- district */

interface DistrictProps {
  value: string | null;
  onChange(next: string): void;
}

/** Icon/card list of Sindh districts with audio labels (docs/11 §3.2 step 7). */
export function DistrictList({ value, onChange }: DistrictProps) {
  const { lang } = useI18n();
  return (
    <ul className="grid grid-cols-2 gap-2">
      {SINDH_DISTRICTS.map((district) => {
        const selected = value === district;
        const label = districtLabel(district, lang);
        return (
          <li key={district}>
            <button
              type="button"
              onClick={() => onChange(district)}
              aria-pressed={selected}
              className={`flex min-h-primary w-full items-center gap-2 rounded-2xl border-2 px-3 text-start text-sm font-bold ${
                selected ? 'border-teal-700 bg-teal-600 text-white' : 'border-ink/15 bg-white text-ink'
              }`}
            >
              <span
                aria-hidden
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-bold ${
                  selected ? 'bg-white/20 text-white' : 'bg-teal-600/10 text-teal-700'
                }`}
              >
                {district.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {selected && <IconCheck size={18} className="shrink-0" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------------- year */

interface YearPickerProps {
  value: string | null;
  onChange(next: string): void;
}

/** Year selector for date of birth — age is all the rule engine needs. */
export function YearPicker({ value, onChange }: YearPickerProps) {
  const years = useMemo(() => {
    const now = new Date().getFullYear();
    const list: number[] = [];
    for (let year = now - 12; year >= now - 90; year -= 1) list.push(year);
    return list;
  }, []);

  return (
    <div className="max-h-[46vh] overflow-y-auto rounded-2xl border-2 border-ink/10 bg-white p-2">
      <ul className="grid grid-cols-3 gap-2">
        {years.map((year) => {
          const selected = value === String(year);
          return (
            <li key={year}>
              <button
                type="button"
                onClick={() => onChange(String(year))}
                aria-pressed={selected}
                className={`num min-h-tap w-full rounded-xl border-2 text-base font-bold ${
                  selected ? 'border-teal-700 bg-teal-600 text-white' : 'border-ink/10 bg-white text-ink'
                }`}
              >
                {year}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------- misc */

export function CnicDisplay({ digits }: { digits: string }) {
  return (
    <span className="num" dir="ltr">
      {formatCnic(digits)}
    </span>
  );
}

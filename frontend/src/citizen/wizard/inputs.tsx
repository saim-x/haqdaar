import { useMemo } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider';
import { AudioButton } from '../../shared/ui/AudioButton';
import { IconBackspace, IconCheck, IconCross, IconMinus, IconPlus, IconQuestion } from '../../shared/ui/Icons';
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
}

/**
 * Large 0–9 visual keypad. Keys are 56 px tall so a woman who has never used a
 * smartphone can still hit them; the formatted value is read-only above.
 *
 * The keys are hairline surfaces, not 2px frames: fourteen bordered boxes on one
 * screen reads as a spreadsheet. The value is the only thing with weight.
 */
export function DigitPad({
  value,
  onChange,
  maxDigits,
  format,
  onUnknown,
  unknown,
}: DigitPadProps) {
  const { t, isRtl } = useI18n();
  const display = format ? format(value) : value;
  const digitWords = isRtl
    ? ['صفر', 'ایک', 'دو', 'تین', 'چار', 'پانچ', 'چھ', 'سات', 'آٹھ', 'نو']
    : ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const spoken = maxDigits === 13 && value.length === 13 && !value.startsWith('99900')
    ? t('wizard.cnic.invalid')
    : maxDigits === 6 && value
    ? String(Number(value))
    : [...value].map((digit) => digitWords[Number(digit)]).join(', ');

  function press(digit: string) {
    if (value.length >= maxDigits) return;
    onChange(value + digit);
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 rounded-control border border-ink/[0.08] bg-raised px-4 py-3">
        <output
          aria-live="polite"
          className="num min-h-8 flex-1 font-mono text-title-lg font-medium text-ink"
          dir="ltr"
        >
          {display || <span className="text-ink-3">-</span>}
        </output>
        <AudioButton text={unknown ? t('common.dontKnow') : spoken || t('wizard.input.empty')} />
      </div>

      <div className="grid grid-cols-3 gap-2" data-testid="digit-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <button
            key={digit}
            type="button"
            onClick={() => press(digit)}
            className="press num min-h-primary rounded-control border border-ink/[0.10] bg-card font-mono text-title-lg font-medium text-ink hover:bg-raised active:bg-raised"
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange(value.slice(0, -1))}
          aria-label={t('common.delete')}
          className="press grid min-h-primary place-items-center rounded-control border border-ink/[0.10] bg-raised text-ink-2 hover:text-ink"
        >
          <IconBackspace size={24} />
        </button>
        <button
          type="button"
          onClick={() => press('0')}
          className="press num min-h-primary rounded-control border border-ink/[0.10] bg-card font-mono text-title-lg font-medium text-ink hover:bg-raised active:bg-raised"
        >
          0
        </button>
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={t('common.cancel')}
          className="press grid min-h-primary place-items-center rounded-control border border-ink/[0.10] bg-raised text-ink-2 hover:text-ink"
        >
          <IconCross size={20} />
        </button>
      </div>

      {onUnknown && (
        <button
          type="button"
          onClick={onUnknown}
          aria-pressed={unknown}
          className={`press mt-3 flex min-h-primary w-full items-center justify-center gap-2 rounded-control border text-body font-medium ${
            unknown
              ? 'border-warn/40 bg-warn-wash text-warn'
              : 'border-ink/[0.14] bg-card text-ink-2 hover:bg-raised'
          }`}
        >
          <IconQuestion size={20} />
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
}

/** Giant − [ n ] + counter (docs/11 §3.2 steps 8–9). */
export function Counter({ value, onChange, min = 0, max = 20 }: CounterProps) {
  const { t } = useI18n();
  const lessLabel = t('wizard.counter.less');
  const moreLabel = t('wizard.counter.more');
  return (
    <div className="flex items-center justify-center gap-3">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={lessLabel}
        className="press grid h-20 w-20 place-items-center rounded-panel border border-ink/[0.10] bg-card text-ink hover:bg-raised disabled:opacity-40"
      >
        <IconMinus size={28} />
      </button>
      <output
        aria-live="polite"
        className="num grid h-20 min-w-24 place-items-center rounded-panel border border-ink/[0.08] bg-raised px-4 font-mono text-display-lg font-medium text-ink"
      >
        {value}
      </output>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={moreLabel}
        className="press grid h-20 w-20 place-items-center rounded-panel border border-ink/[0.10] bg-card text-ink hover:bg-raised disabled:opacity-40"
      >
        <IconPlus size={28} />
      </button>
      <AudioButton text={String(value)} size="lg" />
    </div>
  );
}

/* ------------------------------------------------------------------ income */

export const INCOME_BANDS = [
  { key: 'wizard.income.band1', value: 15000, bars: 1 },
  { key: 'wizard.income.band2', value: 25000, bars: 2 },
  { key: 'wizard.income.band3', value: 35000, bars: 3 },
  { key: 'wizard.income.band4', value: 50000, bars: 4 },
] as const;

interface IncomeProps {
  value: number | null;
  onChange(next: number | null): void;
  exact: boolean;
  onExactChange(next: boolean): void;
  exactDigits: string;
  onExactDigits(next: string): void;
}

/** Tap bands with visual tier bars or an exact keypad amount (docs/11 §3.2 step 10). */
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
              className={`press flex min-h-primary flex-col items-center justify-center gap-1.5 rounded-control border px-2 py-2.5 text-body font-medium ${
                selected
                  ? 'border-accent/40 bg-accent-wash text-accent-ink'
                  : 'border-ink/[0.10] bg-card text-ink hover:bg-raised'
              }`}
            >
              <span className="flex items-end gap-1" aria-hidden>
                {Array.from({ length: 4 }, (_, idx) => (
                  <span
                    key={idx}
                    className={`w-1.5 rounded-full ${
                      idx < band.bars ? (selected ? 'bg-accent' : 'bg-ink-2') : 'bg-ink/15'
                    }`}
                    style={{ height: `${8 + idx * 3}px` }}
                  />
                ))}
              </span>
              <span className="flex items-center gap-1 tabular-nums">
                {selected && <IconCheck size={14} className="shrink-0" />}
                <span>{t(band.key)}</span>
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => onExactChange(!exact)}
        aria-pressed={exact}
        className={`press mt-2 min-h-tap w-full rounded-control border text-caption font-medium ${
          exact
            ? 'border-accent/40 bg-accent-wash text-accent-ink'
            : 'border-ink/[0.10] bg-card text-ink-2 hover:bg-raised'
        }`}
      >
        {t('wizard.income.exact')}
      </button>

      {exact && (
        <div className="mt-3">
          <DigitPad
            value={exactDigits}
            onChange={(next) => {
              onExactDigits(next);
              onChange(next ? Number(next) : null);
            }}
            maxDigits={6}
            format={(digits) => (digits ? Number(digits).toLocaleString('en-PK') : '')}
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
              className={`press flex min-h-primary w-full items-center gap-2 rounded-control border px-3 text-start text-body font-medium ${
                selected
                  ? 'border-accent/40 bg-accent-wash text-accent-ink'
                  : 'border-ink/[0.10] bg-card text-ink hover:bg-raised'
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {selected && <IconCheck size={16} className="shrink-0" />}
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

/** Year selector with approximate-age presets for low-literacy citizens who know their age, not Gregorian birth year. */
export function YearPicker({ value, onChange }: YearPickerProps) {
  const { isRtl } = useI18n();
  const currentYear = new Date().getFullYear();
  const years = useMemo(() => {
    const list: number[] = [];
    for (let year = currentYear - 12; year >= currentYear - 90; year -= 1) list.push(year);
    return list;
  }, [currentYear]);

  const agePresets = [25, 35, 45, 55, 65];
  const selectedYear = value ? Number(value) : null;
  const approxAge = selectedYear && selectedYear > 1900 ? currentYear - selectedYear : null;

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-meta font-medium text-ink-2">
          {isRtl ? 'اندازاً عمر منتخب کریں (اگر سال یاد نہیں)' : 'Pick approximate age (if birth year is unsure)'}
          {approxAge !== null && (
            <span className="num ms-2 font-mono text-accent-ink">
              (~{approxAge} {isRtl ? 'سال' : 'yrs'})
            </span>
          )}
        </p>
        <div className="grid grid-cols-5 gap-1.5">
          {agePresets.map((age) => {
            const yr = String(currentYear - age);
            const active = value === yr;
            return (
              <button
                key={age}
                type="button"
                onClick={() => onChange(yr)}
                aria-pressed={active}
                className={`press num min-h-tap rounded-control border font-mono text-caption font-medium ${
                  active
                    ? 'border-accent/40 bg-accent-wash text-accent-ink'
                    : 'border-ink/[0.10] bg-raised text-ink hover:border-ink/25'
                }`}
              >
                ~{age}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-h-[38vh] overflow-y-auto rounded-control border border-ink/[0.08] bg-card p-2">
        <ul className="grid grid-cols-3 gap-2">
          {years.map((year) => {
            const selected = value === String(year);
            return (
              <li key={year}>
                <button
                  type="button"
                  onClick={() => onChange(String(year))}
                  aria-pressed={selected}
                  className={`press num min-h-tap w-full rounded-[7px] border font-mono text-body font-medium ${
                    selected
                      ? 'border-accent/40 bg-accent-wash text-accent-ink'
                      : 'border-transparent bg-raised text-ink hover:border-ink/[0.10]'
                  }`}
                >
                  {year}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- misc */

export function CnicDisplay({ digits }: { digits: string }) {
  return (
    <span className="num font-mono" dir="ltr">
      {formatCnic(digits)}
    </span>
  );
}

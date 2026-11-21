import { useI18n } from '../i18n/I18nProvider';

/**
 * Wizard progress - docs/11 §3.2, "no dense text, just where am I".
 *
 * A continuous hairline track with a fill, not a row of segments. At fourteen
 * steps the segments were 20 px wide with 4 px gaps: a barcode nobody can
 * count, which is the one thing a segmented bar is supposed to be good at. The
 * counter carries the exact position; the track only has to carry "how far".
 *
 * The fill is a percentage of the track, so it grows from the start edge in
 * either direction without a direction-specific rule.
 */
export function ProgressDots({ total, current }: { total: number; current: number }) {
  const { t, lang } = useI18n();
  const percent = total > 0 ? Math.min(100, Math.round(((current + 1) / total) * 100)) : 0;

  return (
    <div
      className="flex items-center gap-3"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current + 1}
      aria-valuetext={`${t('common.step')} ${current + 1} ${t('common.of')} ${total}`}
    >
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/[0.10]" aria-hidden>
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-enter ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="shrink-0 text-caption font-medium text-accent-ink">
        {lang === 'ur' ? `مرحلہ ${current + 1} از ${total}` : `Step ${current + 1} of ${total}`}
      </span>
    </div>
  );
}

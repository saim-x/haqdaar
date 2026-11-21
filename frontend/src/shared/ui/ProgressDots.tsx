import { useI18n } from '../i18n/I18nProvider';

/**
 * Wizard progress — docs/11 §3.2, "no dense text, just where am I".
 *
 * A segmented hairline track rather than a row of dots: it reads as a form's
 * progress bar, fills from the start edge in either direction, and stays legible
 * at 14 steps. The current segment is the only accent on the screen.
 */
export function ProgressDots({ total, current }: { total: number; current: number }) {
  const { t } = useI18n();
  return (
    <div
      className="flex items-center gap-3"
      role="group"
      aria-label={`${t('common.step')} ${current + 1} ${t('common.of')} ${total}`}
    >
      <div className="flex flex-1 items-center gap-1" aria-hidden>
        {Array.from({ length: total }, (_, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <span
              key={i}
              aria-current={active ? 'step' : undefined}
              className={[
                'h-1 flex-1 rounded-full',
                'transition-colors duration-hover ease-out',
                active ? 'bg-accent' : done ? 'bg-accent/40' : 'bg-ink/[0.10]',
              ].join(' ')}
            />
          );
        })}
      </div>
      <span className="num shrink-0 text-meta font-medium text-ink-3">
        {current + 1}/{total}
      </span>
    </div>
  );
}

import { useI18n } from '../i18n/I18nProvider';

/**
 * Progress dots for the wizard — no dense text, just "where am I" (docs/11 §3.2).
 * The current dot is also announced to screen readers.
 */
export function ProgressDots({ total, current }: { total: number; current: number }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center gap-1.5" role="group" aria-label={`${t('common.step')} ${current + 1} ${t('common.of')} ${total}`}>
      {Array.from({ length: total }, (_, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <span
            key={i}
            aria-current={active ? 'step' : undefined}
            className={[
              'h-2.5 rounded-full transition-all',
              active ? 'w-7 bg-teal-600' : done ? 'w-2.5 bg-teal-600/60' : 'w-2.5 bg-ink/15',
            ].join(' ')}
          />
        );
      })}
      <span className="ms-2 text-xs font-semibold text-ink-soft">
        {current + 1}/{total}
      </span>
    </div>
  );
}

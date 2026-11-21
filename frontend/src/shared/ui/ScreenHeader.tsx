import type { ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { AudioButton } from './AudioButton';
import { BackLink } from './BackLink';

/**
 * Every citizen screen opens the same way: an optional back link, the page name,
 * one line of context, and the speaker affordance on the end edge.
 *
 * Having one header means the rhythm is identical across fourteen screens, which
 * is what makes the app feel like one thing rather than fourteen.
 */
export function ScreenHeader({
  title,
  hint,
  meta,
  audioKey,
  audioText,
  backTo,
  backLabel,
  actions,
}: {
  title: string;
  hint?: string;
  meta?: ReactNode;
  audioKey?: string;
  audioText?: string;
  backTo?: string;
  backLabel?: string;
  actions?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <header className="enter enter-1 mb-5">
      {(backTo || meta) && (
        <div className="mb-3 flex items-center gap-2">
          {backTo && <BackLink to={backTo} label={backLabel ?? t('common.back')} />}
          {meta}
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title font-medium leading-[1.35] text-ink">{title}</h1>
          {hint && <p className="mt-1 text-body leading-[1.7] text-ink-2">{hint}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {(audioKey || audioText) && <AudioButton audioKey={audioKey} text={audioText ?? title} />}
        </div>
      </div>
    </header>
  );
}

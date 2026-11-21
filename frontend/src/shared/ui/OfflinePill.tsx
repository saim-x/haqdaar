import { useI18n } from '../i18n/I18nProvider';
import { useOffline } from '../offline/OfflineProvider';
import { IconCloud, IconRefresh } from './Icons';

/**
 * Connectivity state - docs/11 §5.3.
 *
 * Offline (X saved locally) · Syncing. Text is always present; colour is never
 * the only signal.
 *
 * Online renders nothing. A permanent "Online" dot is the least interesting
 * thing on the screen and it was costing the header 60px on a 390px phone; the
 * states worth interrupting for are the two that need the citizen to act.
 */
export function OfflinePill({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const { online, pending, syncing, needsAttention, retryNow } = useOffline();

  if (syncing) {
    return (
      <span className="inline-flex items-center gap-1.5 text-meta font-medium text-info">
        <IconRefresh size={14} className="animate-spin" />
        {t('common.syncing')}
      </span>
    );
  }

  if (needsAttention.length > 0) {
    return (
      <button
        type="button"
        onClick={retryNow}
        data-testid="offline-pill"
        aria-label={`${t('common.error')} (${needsAttention.length})`}
        className="press inline-flex min-h-tap items-center gap-1.5 rounded-control bg-negative-wash px-2 text-meta font-medium text-negative"
      >
        <IconCloud size={14} />
        <span>{compact ? `! ${needsAttention.length}` : `${t('common.retry')} (${needsAttention.length})`}</span>
      </button>
    );
  }

  if (!online || pending > 0) {
    return (
      <button
        type="button"
        onClick={retryNow}
        data-testid="offline-pill"
        aria-label={`${t('common.offline')} - ${pending} · ${t('common.queued')}`}
        title={t('common.queued')}
        className="press inline-flex min-h-tap items-center gap-1.5 rounded-control bg-warn-wash px-2 text-meta font-medium text-warn"
      >
        <IconCloud size={14} />
        <span>
          {t('common.offline')}
          {pending > 0 ? <span className="num"> ({pending})</span> : null}
        </span>
      </button>
    );
  }

  return null;
}

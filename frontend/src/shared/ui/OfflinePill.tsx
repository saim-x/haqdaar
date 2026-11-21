import { useI18n } from '../i18n/I18nProvider';
import { useOffline } from '../offline/OfflineProvider';
import { IconCloud, IconRefresh } from './Icons';

/**
 * Connectivity state — docs/11 §5.3.
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
  const { online, pending, syncing, retryNow } = useOffline();

  if (syncing) {
    return (
      <span className="inline-flex items-center gap-1.5 text-meta font-medium text-info">
        <IconRefresh size={14} className="animate-spin" />
        {t('common.syncing')}
      </span>
    );
  }

  if (!online || pending > 0) {
    return (
      <button
        type="button"
        onClick={retryNow}
        data-testid="offline-pill"
        // Compact mode shows a bare count, which is meaningless to a screen
        // reader (and collides with the keypad's "0"), so name the state.
        aria-label={`${t('common.offline')} — ${pending} · ${t('common.queued')}`}
        title={t('common.queued')}
        className="press inline-flex min-h-tap items-center gap-1.5 rounded-control px-1.5 text-meta font-medium text-warn"
      >
        <IconCloud size={14} />
        {compact ? <span className="num">{pending}</span> : `${t('common.offline')} (${pending})`}
      </button>
    );
  }

  return null;
}

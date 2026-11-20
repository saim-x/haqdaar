import { useI18n } from '../i18n/I18nProvider';
import { useOffline } from '../offline/OfflineProvider';
import { IconCloud, IconRefresh } from './Icons';

/**
 * Connectivity pill — docs/11 §5.3.
 *   🟢 Online · 🟡 Offline (X items saved locally — will send automatically) · 🔄 Syncing…
 * Text is always present; colour is never the only signal.
 */
export function OfflinePill({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const { online, pending, syncing, retryNow } = useOffline();

  if (syncing) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#1D4ED8]/10 px-2.5 py-1 text-xs font-semibold text-[#1D4ED8]">
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
        className="inline-flex min-h-tap items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700"
        title={t('common.queued')}
      >
        <IconCloud size={14} />
        {compact ? `${pending}` : `${t('common.offline')} (${pending})`}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#0F7B3F]/10 px-2.5 py-1 text-xs font-semibold text-[#0F7B3F]">
      <span aria-hidden className="h-2 w-2 rounded-full bg-[#0F7B3F]" />
      {t('common.online')}
    </span>
  );
}

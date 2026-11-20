import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18nProvider';

/**
 * RULE-5 / AC-25.1 — a persistent 28 px amber bar on EVERY route.
 * It is rendered once in the app shell, above the router outlet, so no screen
 * can accidentally ship without it.
 */
export function PrototypeBanner() {
  const { t } = useI18n();
  return (
    <div
      role="note"
      aria-label={t('banner.text')}
      className="sticky top-0 z-50 flex h-7 items-center justify-center gap-2 bg-amber-400 px-2 text-[11px] font-semibold leading-none text-[#3B2A00] sm:text-xs"
    >
      <span className="truncate">{t('banner.text')}</span>
      <Link
        to="/transparency"
        className="shrink-0 rounded px-1.5 py-0.5 underline decoration-2 underline-offset-2 hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3B2A00]"
      >
        {t('banner.link')}
      </Link>
    </div>
  );
}

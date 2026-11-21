import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18nProvider';

/**
 * RULE-5 / AC-25.1 — a persistent 28 px bar on EVERY route.
 *
 * It is rendered once in the app shell, above the router outlet, so no screen
 * can accidentally ship without it. The height is a hard requirement, so the
 * shell reads it from `--banner-h` rather than hardcoding 28px in three places.
 *
 * Restyled as a quiet amber band: a hairline under it, no shadow, and the link
 * is an underline rather than a second filled chip.
 */
export function PrototypeBanner() {
  const { t } = useI18n();
  return (
    <div
      role="note"
      data-testid="prototype-banner"
      aria-label={t('banner.text')}
      className="sticky top-0 z-50 flex h-7 items-center justify-center gap-2 border-b border-warn/25 bg-warn-wash px-3 text-meta text-warn"
    >
      {/* leading-[1.6] keeps Urdu ascenders and descenders inside the 28 px band:
          the truncating span is a flex item, so overflow:hidden would clip them. */}
      <span className="min-w-0 truncate leading-[1.6]">{t('banner.text')}</span>
      <Link
        to="/transparency"
        className="shrink-0 underline decoration-1 underline-offset-2 transition-colors duration-hover ease-out hover:text-ink"
      >
        {t('banner.link')}
      </Link>
    </div>
  );
}

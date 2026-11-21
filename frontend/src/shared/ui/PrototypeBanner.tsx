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
      aria-label={`${t('banner.claim')} ${t('banner.detail')}`}
      className="sticky top-0 z-50 flex min-h-[var(--banner-h)] items-center justify-center gap-1.5 border-b border-warn/25 bg-warn-wash px-2 py-1 text-meta text-warn sm:gap-2 sm:px-3 sm:py-0"
    >
      {/* leading-[23px] is the measured height of an Urdu line at 12 px — the
          19.2 px a 1.6 ratio gives clips the ascenders inside the 28 px band.
          Below `sm` the bar wraps instead of truncating and the detail clause
          waits for the room: the claim is the part RULE-3 requires on screen,
          and it is the part that must never be cut. */}
      <span className="min-w-0 leading-[1.5] sm:truncate sm:leading-[23px]">
        {t('banner.claim')}
        <span className="hidden sm:inline"> {t('banner.detail')}</span>
      </span>
      <Link
        to="/transparency"
        className="shrink-0 text-[11px] underline decoration-1 underline-offset-2 transition-colors duration-hover ease-out hover:text-ink sm:text-meta"
      >
        {t('banner.link')}
      </Link>
    </div>
  );
}

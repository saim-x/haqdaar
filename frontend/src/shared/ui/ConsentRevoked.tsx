import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18nProvider';
import { IconLock } from './Icons';

/**
 * AC-13.2 / AC-11.2 - what a helper sees the moment a citizen withdraws consent.
 *
 * The server has already refused the read with `403 CONSENT_REVOKED` and has
 * persisted the denied attempt in the access log. This screen therefore shows
 * ZERO personal data: no name, no CNIC, no case reference, no amounts.
 *
 * The paused tone is carried by the icon and the heading, not by a purple wash
 * over the whole card.
 */
export function ConsentRevokedNotice({ backTo = '/h', backLabel }: { backTo?: string; backLabel?: string }) {
  const { t } = useI18n();
  return (
    <div className="screen" data-testid="consent-revoked">
      <div className="card enter mt-6 p-6">
        <div className="flex items-start gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-paused-wash text-paused">
            <IconLock size={20} />
          </span>
          <div className="min-w-0">
            <h1 className="text-title font-medium leading-[1.35] text-ink">
              {t('consent.revokedTitle')}
            </h1>
            <p className="mt-2 text-body leading-[1.7] text-ink-2">
              {t('consent.revokedBody')}
            </p>
            <p className="mt-3 text-caption text-ink-3">
              {t('consent.revokedAgain')}
            </p>
          </div>
        </div>
        <Link
          to={backTo}
          className="press mt-6 inline-flex min-h-tap items-center justify-center rounded-control border border-ink/[0.14] bg-card px-4 text-body font-medium text-ink hover:bg-raised"
        >
          {backLabel ?? t('common.back')}
        </Link>
      </div>
    </div>
  );
}

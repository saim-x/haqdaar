import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/I18nProvider';
import { IconLock } from './Icons';

/**
 * AC-13.2 / AC-11.2 — what a helper sees the moment a citizen withdraws consent.
 *
 * The server has already refused the read with `403 CONSENT_REVOKED` and has
 * persisted the denied attempt in the access log. This screen therefore shows
 * ZERO personal data: no name, no CNIC, no case reference, no amounts.
 */
export function ConsentRevokedNotice({ backTo = '/h', backLabel }: { backTo?: string; backLabel?: string }) {
  const { t, lang } = useI18n();
  return (
    <div className="screen" data-testid="consent-revoked">
      <div className="card mt-6 border-2 border-[#6D28D9]/40 bg-[#6D28D9]/5 p-6 text-center">
        <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-[#6D28D9] text-white">
          <IconLock size={30} />
        </div>
        <h1 className="text-lg font-bold text-[#6D28D9]">
          {lang === 'ur' ? 'اجازت واپس لے لی گئی ہے' : 'Consent was withdrawn'}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink">
          {lang === 'ur'
            ? 'اس شخص نے اپنی معلومات دیکھنے کی اجازت واپس لے لی ہے۔ آپ کوئی معلومات نہیں دیکھ سکتے۔ کوشش ریکارڈ کر لی گئی ہے۔'
            : 'This person has taken back permission to see their information. You cannot see any of it. The attempt has been recorded.'}
        </p>
        <p className="mt-3 text-xs text-ink-soft">
          {lang === 'ur'
            ? 'اگر وہ دوبارہ اجازت دیں تو آپ پھر مدد کر سکتے ہیں۔'
            : 'If they grant permission again, you can help them again.'}
        </p>
        <Link
          to={backTo}
          className="mt-5 inline-flex min-h-tap items-center justify-center rounded-2xl border-2 border-ink/20 bg-white px-4 text-sm font-semibold text-ink"
        >
          {backLabel ?? t('common.back')}
        </Link>
      </div>
    </div>
  );
}

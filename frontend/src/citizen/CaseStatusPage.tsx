import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../shared/api/client';
import { errorMessage } from '../shared/api/errors';
import { useCasePolling } from '../shared/api/useCasePolling';
import { useAuth } from '../shared/auth/AuthProvider';
import { useI18n } from '../shared/i18n/I18nProvider';
import { AudioButton } from '../shared/ui/AudioButton';
import { StatusBadge, statusLabelKey } from '../shared/ui/StatusBadge';
import { TapButton } from '../shared/ui/TapButton';
import { IconArrowLeft, IconCheck, IconClock, IconCoin, IconWarning } from '../shared/ui/Icons';

/**
 * Case status — docs/11 §3.3 / F-10.
 * Icon + colour + audio status card, plain-word timeline, spoken explanation,
 * and the "Money not received" complaint trigger (J-9).
 */
export function CaseStatusPage() {
  const { id = '' } = useParams();
  const { t, lang, pick } = useI18n();
  const { actFor, session } = useAuth();
  const { data, error, loading, fromCache } = useCasePolling(id, actFor?.citizenId ?? session?.citizen?.id ?? null);
  const [complaintState, setComplaintState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [complaintError, setComplaintError] = useState<string | null>(null);

  async function fileComplaint() {
    setComplaintState('sending');
    setComplaintError(null);
    try {
      await api.post(`/cases/${id}/complaint`, { reason: 'MONEY_NOT_RECEIVED' });
      setComplaintState('sent');
    } catch (err) {
      setComplaintState('error');
      setComplaintError(errorMessage(err, lang));
    }
  }

  if (loading && !data) {
    return <div className="screen"><p className="text-sm text-ink-soft">{t('common.loading')}</p></div>;
  }

  if (error && !data) {
    return (
      <div className="screen">
        <div role="alert" className="card border-2 border-[#B42318]/40 p-4">
          <p className="text-sm font-bold text-[#B42318]">{error.code}</p>
          <p className="mt-1 text-sm text-ink">{lang === 'ur' ? error.messageUr : error.messageEn}</p>
        </div>
        <Link to="/c/cases" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-teal-700">
          <IconArrowLeft size={16} className="rtl:rotate-180" />
          {t('cases.title')}
        </Link>
      </div>
    );
  }

  if (!data) return null;

  const explanation = data.citizen_explanation;
  const headline = explanation ? pick(explanation.headline_ur, explanation.headline_en) : t(statusLabelKey(data.status));
  const reasons = explanation ? (lang === 'ur' ? explanation.reasons_ur : explanation.reasons_en) : [];
  const nextStep = explanation ? pick(explanation.next_step_ur, explanation.next_step_en) : '';
  const canComplain = ['APPROVED', 'PAID', 'PAYMENT_FAILED', 'PAYMENT_INITIATED'].includes(data.status);

  return (
    <div className="screen">
      <header className="mb-3 mt-1 flex items-center gap-2">
        <Link to="/c/cases" className="grid h-tap w-tap place-items-center rounded-full hover:bg-ink/5" aria-label={t('cases.title')}>
          <IconArrowLeft size={20} className="rtl:rotate-180" />
        </Link>
        <p className="num text-xs font-semibold text-ink-soft">{data.reference_code}</p>
        {fromCache && (
          <span className="ms-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
            {t('common.offline')}
          </span>
        )}
      </header>

      <section className="card mb-4 p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <StatusBadge status={data.status} size="lg" />
            <p className="mt-3 text-lg font-bold leading-snug text-ink">{headline}</p>
            {data.approved_amount_pkr !== null && (
              <p className="num mt-2 inline-flex items-center gap-1.5 text-2xl font-bold text-[#0F7B3F]">
                <IconCoin size={24} />
                {data.approved_amount_pkr.toLocaleString()} PKR
              </p>
            )}
          </div>
          <AudioButton size="lg" audioKey={`status_${data.status.toLowerCase()}`} text={headline} />
        </div>
      </section>

      {reasons.length > 0 && (
        <section className="card mb-4 p-4">
          <h2 className="mb-2 text-sm font-bold text-ink">{t('cases.explanation')}</h2>
          <ul className="space-y-2">
            {reasons.slice(0, 3).map((reason) => (
              <li key={reason} className="flex items-start gap-2 text-sm text-ink">
                <IconCheck size={18} className="mt-0.5 shrink-0 text-[#0F7B3F]" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
          {nextStep && (
            <p className="mt-3 rounded-xl bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-800">{nextStep}</p>
          )}
        </section>
      )}

      {data.timeline.length > 0 && (
        <section className="card mb-4 p-4">
          <h2 className="mb-2 text-sm font-bold text-ink">{t('cases.timeline')}</h2>
          <ol className="space-y-2">
            {data.timeline.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="flex items-start gap-2">
                <IconClock size={16} className="mt-0.5 shrink-0 text-ink-soft" />
                <div className="min-w-0">
                  <p className="text-sm text-ink">{pick(entry.label_ur, entry.label_en)}</p>
                  <p className="num text-[11px] text-ink-soft">{new Date(entry.at).toLocaleString()}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {canComplain && (
        <section className="card mb-4 p-4">
          <h2 className="text-sm font-bold text-ink">{t('cases.moneyNotReceived')}</h2>
          <p className="mt-0.5 text-xs text-ink-soft">{t('cases.moneyNotReceivedHint')}</p>
          {complaintState === 'sent' ? (
            <p className="mt-2 rounded-xl bg-[#0F7B3F]/10 px-3 py-2 text-sm font-semibold text-[#0F7B3F]">
              {t('cases.complaintFiled')}
            </p>
          ) : (
            <TapButton
              variant="secondary"
              size="tap"
              block
              className="mt-2"
              onClick={() => void fileComplaint()}
              disabled={complaintState === 'sending'}
              icon={<IconWarning size={18} />}
            >
              {t('cases.moneyNotReceived')}
            </TapButton>
          )}
          {complaintError && <p className="mt-2 text-xs font-semibold text-[#B42318]">{complaintError}</p>}
        </section>
      )}

      <Link to="/c/consent" className="block text-center text-sm font-semibold text-teal-700">
        {t('consent.title')}
      </Link>
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useParams } from 'react-router-dom';
import { api } from '../shared/api/client';
import { errorMessage } from '../shared/api/errors';
import { useCasePolling } from '../shared/api/useCasePolling';
import { useAuth } from '../shared/auth/AuthProvider';
import { useI18n } from '../shared/i18n/I18nProvider';
import { stamp } from '../shared/lib/dates';
import { pkr } from '../shared/lib/money';
import { AudioButton } from '../shared/ui/AudioButton';
import { StatusBadge, statusLabelKey } from '../shared/ui/StatusBadge';
import { TapButton } from '../shared/ui/TapButton';
import { IconArrowLeft, IconWarning } from '../shared/ui/Icons';


/**
 * Case status — docs/11 §3.3 / F-10.
 *
 * The moment on this screen is the amount: one large tabular figure with the
 * currency as a quiet suffix, and the stamp beside it once the case is approved.
 * Everything else is a hairline list, so the figure is the only thing that
 * carries weight.
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
    return (
      <div className="screen">
        <p className="text-caption text-ink-3" role="status">
          {t('common.loading')}
        </p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="screen">
        <div role="alert" className="card border-negative/25 p-4">
          <p className="font-mono text-meta text-negative">{error.code}</p>
          <p className="mt-1 text-body text-ink">{lang === 'ur' ? error.messageUr : error.messageEn}</p>
        </div>
        <Link to="/c/cases" className="mt-4 inline-flex items-center gap-1 text-caption font-medium text-accent-ink">
          {t('cases.title')}
        </Link>
      </div>
    );
  }

  if (!data) return null;

  const explanation = data.citizen_explanation;
  // docs/04 §3.3 — the server owns the citizen-facing status string; the local
  // dictionary is only a fallback for a cached payload from an older build.
  const serverLabel = data.status_label
    ? lang === 'ur'
      ? data.status_label.label_ur
      : data.status_label.label_en
    : null;
  const headline = explanation
    ? pick(explanation.headline_ur, explanation.headline_en)
    : (serverLabel ?? t(statusLabelKey(data.status)));
  const reasons = explanation ? (lang === 'ur' ? explanation.reasons_ur : explanation.reasons_en) : [];
  const nextStep = explanation ? pick(explanation.next_step_ur, explanation.next_step_en) : '';
  const canComplain = ['APPROVED', 'PAID', 'PAYMENT_FAILED', 'PAYMENT_INITIATED'].includes(data.status);
  const settled = ['APPROVED', 'PAID', 'PAYMENT_INITIATED'].includes(data.status);

  return (
    <div className="screen">
      <header className="enter enter-1 mb-4 flex items-center gap-2">
        <Link
          to="/c/cases"
          className="press -ms-2 grid h-tap w-tap place-items-center rounded-control text-ink-2 hover:bg-raised hover:text-ink"
          aria-label={t('cases.title')}
        >
          <IconArrowLeft size={20} />
        </Link>
        <span className="num font-mono text-meta text-ink-3">{data.reference_code}</span>
        {fromCache && <span className="ms-auto text-meta font-medium text-warn">{t('common.offline')}</span>}
      </header>

      <section className="card enter enter-2 p-5">
        <div className="flex items-start justify-between gap-3">
          <StatusBadge status={data.status} size="lg" />
          <AudioButton size="lg" audioKey={`status_${data.status.toLowerCase()}`} text={headline} />
        </div>

        <p className="mt-3 text-lead leading-[1.6] text-ink">{headline}</p>

        {data.approved_amount_pkr !== null && (
          <div className="mt-4 flex items-end gap-3 border-t border-ink/[0.08] pt-4">
            <p className="num font-mono text-display font-medium leading-none text-ink">
              {pkr(data.approved_amount_pkr)}
            </p>
            <p className="pb-0.5 text-caption text-ink-3">PKR</p>
            {settled && <span className="stamp ms-auto">{t('cases.approvedStamp')}</span>}
          </div>
        )}
      </section>

      {reasons.length > 0 && (
        <section className="enter enter-3 mt-6">
          <h2 className="section-label mb-3">{t('cases.explanation')}</h2>
          <ul className="border-y border-ink/[0.08]">
            {reasons.slice(0, 3).map((reason) => (
              <li key={reason} className="flex items-start gap-2.5 border-b border-ink/[0.08] py-2.5 last:border-b-0">
                <span aria-hidden className="mt-[11px] h-1 w-1 shrink-0 rounded-full bg-ink-3" />
                <span className="text-body leading-[1.7] text-ink">{reason}</span>
              </li>
            ))}
          </ul>
          {nextStep && (
            <p className="mt-3 rounded-control bg-accent-wash px-3 py-2.5 text-caption font-medium leading-[1.7] text-accent-ink">
              {nextStep}
            </p>
          )}
        </section>
      )}

      {data.timeline.length > 0 && (
        <section className="enter enter-4 mt-6">
          <h2 className="section-label mb-3">{t('cases.timeline')}</h2>
          {/* The signature hairline, used as the timeline spine. Marker and
              spine share one grid column, so the dot sits on the line in both
              directions without a magic offset. */}
          <ol>
            {data.timeline.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="grid grid-cols-[auto_1fr] gap-x-3">
                <span aria-hidden className="flex flex-col items-center">
                  <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-ink-3" />
                  {index < data.timeline.length - 1 && (
                    <span className="mt-1 w-px flex-1 bg-ink/[0.08]" />
                  )}
                </span>
                <div className="pb-4">
                  <p className="text-body leading-[1.6] text-ink">{pick(entry.label_ur, entry.label_en)}</p>
                  <p className="mt-0.5 text-meta text-ink-3">
                    <bdi className="num">{stamp(entry.at, lang)}</bdi>
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {canComplain && (
        <section className="enter enter-5 mt-6">
          <h2 className="section-label mb-3">{t('cases.moneyNotReceived')}</h2>
          <p className="mb-3 text-caption leading-[1.7] text-ink-2">{t('cases.moneyNotReceivedHint')}</p>
          {complaintState === 'sent' ? (
            <p className="rounded-control bg-positive-wash px-3 py-2.5 text-caption font-medium text-positive">
              {t('cases.complaintFiled')}
            </p>
          ) : (
            <TapButton
              variant="secondary"
              size="tap"
              block
              onClick={() => void fileComplaint()}
              disabled={complaintState === 'sending'}
              icon={<IconWarning size={18} />}
            >
              {t('cases.moneyNotReceived')}
            </TapButton>
          )}
          {complaintError && <p className="mt-2 text-meta font-medium text-negative">{complaintError}</p>}
        </section>
      )}

      <Link
        to="/c/consent"
        className="mt-8 block text-center text-caption font-medium text-accent-ink underline decoration-1 underline-offset-4"
      >
        {t('consent.title')}
      </Link>
    </div>
  );
}

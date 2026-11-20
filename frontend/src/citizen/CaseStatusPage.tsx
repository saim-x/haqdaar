import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, MessageSquareText, RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, uuid } from '../shared/api/client';
import { ai, cases, me } from '../shared/api/endpoints';
import { currentCitizenId } from '../shared/auth/session';
import { formatDateTime, formatPkr, useT } from '../shared/i18n';
import { useSettings } from '../shared/settings';
import { isInFlight, STATUS, toneClasses } from '../shared/status';
import { AudioButton } from '../shared/ui/AudioButton';
import { Button } from '../shared/ui/Button';
import { cx } from '../shared/ui/cx';
import { Modal } from '../shared/ui/Modal';
import { PageLoader } from '../shared/ui/Spinner';
import { useAutoRead } from './useAutoRead';

/** Polling with back-off: at most 1 request / 5 s, growing to 60 s (AC-10.2). */
function usePollInterval(active: boolean) {
  const [ms, setMs] = useState(5000);
  useEffect(() => {
    if (!active) setMs(5000);
  }, [active]);
  return { ms: active ? ms : false as const, bump: () => setMs((m) => Math.min(60000, Math.round(m * 1.5))) };
}

export function CaseStatusPage() {
  const { id } = useParams();
  const { t, lang, pick } = useT();
  const { liteMode } = useSettings();
  const qc = useQueryClient();
  const citizenId = currentCitizenId();
  const [inFlight, setInFlight] = useState(true);
  const poll = usePollInterval(inFlight && !liteMode);
  const lastStatus = useRef<string | null>(null);

  const q = useQuery({
    queryKey: ['case', id],
    queryFn: () => cases.get(id!),
    refetchInterval: poll.ms,
    enabled: !!id,
  });
  const notesQ = useQuery({ queryKey: ['notifications', citizenId], queryFn: me.notifications, staleTime: 10_000 });

  useEffect(() => {
    if (!q.data) return;
    setInFlight(isInFlight(q.data.status));
    if (lastStatus.current === q.data.status) poll.bump();
    else if (lastStatus.current) void qc.invalidateQueries({ queryKey: ['notifications'] });
    lastStatus.current = q.data.status;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, q.dataUpdatedAt]);

  const [complaintOpen, setComplaintOpen] = useState(false);
  const complaint = useMutation({
    mutationFn: () => cases.complaint(id!, 'MONEY_NOT_RECEIVED', uuid()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cases'] });
    },
  });

  const c = q.data;
  const meta = c ? STATUS[c.status] : null;
  const ex = c?.citizen_explanation;
  const headline = ex ? pick(ex.headline_ur, ex.headline_en) : meta ? t(meta.label) : '';
  const reasons = ex ? (lang === 'ur' ? ex.reasons_ur : ex.reasons_en) : [];
  const nextStep = ex ? pick(ex.next_step_ur, ex.next_step_en) : '';
  const spoken = [headline, ...reasons, nextStep].filter(Boolean).join('۔ ');
  useAutoRead(meta?.clip, spoken, [c?.status]);

  if (q.isLoading) return <PageLoader label={t('loading')} />;
  if (q.error) {
    const e = q.error as ApiError;
    return (
      <div role="alert" className="rounded-card border-2 border-consent/40 bg-consent-soft p-6 text-center">
        <TriangleAlert className="mx-auto mb-2 h-10 w-10 text-consent" aria-hidden />
        <p className="text-lg font-semibold">{e.code === 'CONSENT_REVOKED' ? t('accessBlocked') : pick(e.messageUr, e.message)}</p>
        {e.code === 'CONSENT_REVOKED' && <p className="mt-1 text-muted">{t('accessBlockedBody')}</p>}
      </div>
    );
  }
  if (!c || !meta) return null;

  const tone = toneClasses[meta.tone];
  const Icon = meta.icon;
  const caseNotes = (notesQ.data ?? []).filter((n) => n.case_id === c.id);
  const canComplain = c.case_type === 'BENEFIT_APPLICATION' && ['APPROVED', 'PAID', 'PAYMENT_FAILED'].includes(c.status);

  return (
    <div className="space-y-5 animate-rise">
      <div className={cx('rounded-card border-2 p-5', tone.border, tone.soft)}>
        <div className="flex items-start gap-4">
          <span className={cx('inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl', tone.solid)}>
            <Icon className="h-9 w-9" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className={cx('text-sm font-bold', tone.text)}>{t(meta.label)}</p>
            <h1 className="mt-1 text-2xl font-bold leading-snug">{headline}</h1>
          </div>
          <AudioButton clip={ex ? undefined : meta.clip} text={spoken} label={t('caseTitle')} ttsUrl={ex ? ttsFor(spoken, lang) : undefined} />
        </div>
        {(c.approved_amount_pkr || c.payment?.amount_pkr) && (
          <p className="mt-4 text-4xl font-bold text-ok">{formatPkr(c.payment?.amount_pkr ?? c.approved_amount_pkr, lang)}</p>
        )}
        {inFlight && (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted">
            <RefreshCw className="h-4 w-4 animate-spin-slow" aria-hidden />
            {t('autoRefresh')}
          </p>
        )}
      </div>

      {reasons.length > 0 && (
        <section className="card p-4">
          <h2 className="mb-2 text-lg font-bold">{t('whyTitle')}</h2>
          <ul className="space-y-2">
            {reasons.slice(0, 3).map((r) => (
              <li key={r} className="flex gap-2 text-lg">
                <span className={cx('mt-2.5 h-2 w-2 shrink-0 rounded-full', tone.solid)} aria-hidden />
                {r}
              </li>
            ))}
          </ul>
        </section>
      )}

      {nextStep && (
        <section className="card p-4">
          <h2 className="mb-1 text-lg font-bold">{t('nextTitle')}</h2>
          <p className="text-lg">{nextStep}</p>
          {['HUMAN_REVIEW', 'IN_REVIEW', 'PENDING_SECOND_APPROVAL', 'WAITING_EXTERNAL'].includes(c.status) && (
            <p className="mt-2 font-semibold text-brand">{t('waitNoAction')}</p>
          )}
        </section>
      )}

      {c.status === 'NEEDS_INFO' && (
        <Link to={`/c/apply?case=${c.id}`}>
          <Button size="xl" block variant="primary">
            {t('fixNow')}
          </Button>
        </Link>
      )}

      {c.payment?.external_ref && (
        <div className="card flex items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm text-muted">{t('paymentRef')}</p>
            <p className="num font-mono font-semibold">{c.payment.external_ref}</p>
          </div>
          <span className="rounded-full bg-sunken px-2 py-1 text-xs font-semibold text-muted">Raast · simulated</span>
        </div>
      )}

      {caseNotes.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <MessageSquareText className="h-5 w-5" aria-hidden />
            {t('messages')}
          </h2>
          {caseNotes.map((n) => (
            <div key={n.id} className="card p-4">
              <p className="font-semibold">{pick(n.title_ur, n.title_en)}</p>
              <p className="mt-1 text-muted">{pick(n.body_ur, n.body_en)}</p>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-sm text-muted">{t('verificationCode')}:</span>
                <span className="num rounded bg-brand-soft px-2 py-0.5 font-mono font-bold text-brand">{n.verification_code}</span>
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-sunken"
                  onClick={() => void navigator.clipboard?.writeText(n.verification_code)}
                  aria-label="Copy"
                >
                  <Copy className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="card p-4">
        <h2 className="mb-3 text-lg font-bold">{t('timeline')}</h2>
        <ol className="relative space-y-4 border-s-2 border-line ps-5">
          {c.timeline.map((it, i) => (
            <li key={`${it.at}-${i}`} className="relative">
              <span className={cx('absolute -start-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-surface', i === c.timeline.length - 1 ? tone.solid : 'bg-line-strong')} aria-hidden />
              <p className="font-medium">{pick(it.label_ur, it.label_en)}</p>
              <p className="num text-sm text-muted">{formatDateTime(it.at, lang)}</p>
            </li>
          ))}
        </ol>
        <p className="num mt-4 text-sm text-muted">
          {t('reference')}: {c.reference_code}
        </p>
      </section>

      {canComplain && (
        <>
          <Button size="lg" variant="secondary" block onClick={() => setComplaintOpen(true)} icon={<TriangleAlert className="h-6 w-6 text-warn" aria-hidden />}>
            {t('moneyNotReceived')}
          </Button>
          <Modal
            open={complaintOpen}
            onClose={() => setComplaintOpen(false)}
            title={t('moneyNotReceived')}
            closeLabel={t('close')}
            footer={
              complaint.isSuccess ? (
                <Button onClick={() => setComplaintOpen(false)}>{t('close')}</Button>
              ) : (
                <>
                  <Button variant="ghost" onClick={() => setComplaintOpen(false)}>
                    {t('cancel')}
                  </Button>
                  <Button loading={complaint.isPending} onClick={() => complaint.mutate()}>
                    {t('confirm')}
                  </Button>
                </>
              )
            }
          >
            {complaint.isSuccess ? (
              <p className="text-lg font-semibold text-ok">{t('complaintFiled')}</p>
            ) : (
              <p className="text-lg">{pick('ہم ادائیگی کی صورتحال چیک کریں گے اور ضرورت ہو تو شکایت درج کریں گے۔', 'We will check the payment status and file a complaint if needed.')}</p>
            )}
            {complaint.error && <p className="mt-2 text-danger">{pick((complaint.error as ApiError).messageUr, complaint.error.message)}</p>}
          </Modal>
        </>
      )}
    </div>
  );
}

// Dynamic personalised audio (with amounts) can come from /voice/tts.
export const ttsFor = (text: string, lang: 'ur' | 'en') => async () => (await ai.tts(text, lang)).url;

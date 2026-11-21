import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../shared/api/client';
import { errorMessage } from '../shared/api/errors';
import type { ConsentAccessLog, ConsentGrant } from '../shared/api/types';
import { grantRecipientLabel } from '../shared/lib/consent';
import { dayMonth, stamp } from '../shared/lib/dates';
import { useI18n } from '../shared/i18n/I18nProvider';
import { AudioButton } from '../shared/ui/AudioButton';
import { ScreenHeader } from '../shared/ui/ScreenHeader';
import { TapButton } from '../shared/ui/TapButton';
import { IconCross, IconLock, IconUsers } from '../shared/ui/Icons';

const CATEGORY_LABELS: Record<string, { ur: string; en: string }> = {
  IDENTITY: { ur: 'شناخت', en: 'Identity' },
  HOUSEHOLD: { ur: 'گھریلو معلومات', en: 'Household' },
  DOCUMENTS: { ur: 'دستاویزات', en: 'Documents' },
  PAYMENT: { ur: 'ادائیگی', en: 'Payment' },
  CASE_HISTORY: { ur: 'درخواست کی تاریخ', en: 'Case history' },
};

const PURPOSE_LABELS: Record<string, { ur: string; en: string }> = {
  BENEFIT_APPLICATION: { ur: 'درخواست کی جانچ', en: 'Benefit application' },
  PAYMENT_DISBURSEMENT: { ur: 'رقم بھیجنا', en: 'Payment' },
  HELPER_ASSISTANCE: { ur: 'مدد کرنا', en: 'Helper assistance' },
  COMPLAINT_RESOLUTION: { ur: 'شکایت کا حل', en: 'Complaint resolution' },
};

/** Why a grant is no longer live. The section heading says "withdrawn", so the
 *  row has to say which of the two it actually was. */
const INACTIVE_LABELS: Record<string, { ur: string; en: string }> = {
  WITHDRAWN: { ur: 'واپس لی گئی', en: 'Withdrawn' },
  EXPIRED: { ur: 'ختم ہو گئی', en: 'Expired' },
};



/**
 * Consent Center — docs/11 §3.3, F-11.
 *
 * Grant cards, the department-withdrawal warning (AC-11.3), and the access log
 * that shows BLOCKED attempts too (AC-11.2).
 *
 * The access log is the point of this screen, so it is a hairline list where the
 * verdict is a dot and a word — not two competing coloured pills per row.
 */
export function ConsentPage() {
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const [pendingWithdraw, setPendingWithdraw] = useState<ConsentGrant | null>(null);
  const [error, setError] = useState<string | null>(null);

  const grants = useQuery({
    queryKey: ['consent-grants'],
    queryFn: () => api.get<{ items: ConsentGrant[] }>('/consent/grants'),
  });

  const logs = useQuery({
    queryKey: ['consent-access-logs'],
    queryFn: () => api.get<{ items: ConsentAccessLog[] }>('/consent/access-logs'),
    refetchInterval: 30_000,
  });

  const withdraw = useMutation({
    mutationFn: ({ grant, confirmCaseHold }: { grant: ConsentGrant; confirmCaseHold: boolean }) =>
      api.post(`/consent/grants/${grant.id}/withdraw`, confirmCaseHold ? { confirm_case_hold: true } : {}),
    onSuccess: () => {
      setPendingWithdraw(null);
      void queryClient.invalidateQueries({ queryKey: ['consent-grants'] });
      void queryClient.invalidateQueries({ queryKey: ['consent-access-logs'] });
    },
    onError: (err) => setError(errorMessage(err, lang)),
  });

  const active = grants.data?.items.filter((g) => g.status === 'ACTIVE') ?? [];
  const inactive = grants.data?.items.filter((g) => g.status !== 'ACTIVE') ?? [];

  return (
    <div className="screen">
      <ScreenHeader
        title={t('consent.title')}
        hint={t('consent.whoHasData')}
        audioKey="consent_intro"
        audioText={t('consent.whoHasData')}
      />

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-control border border-negative/25 bg-negative-wash px-4 py-3 text-caption font-medium text-negative"
        >
          {error}
        </div>
      )}

      {grants.isLoading && (
        <p className="text-caption text-ink-3" role="status">
          {t('common.loading')}
        </p>
      )}

      {active.length === 0 && !grants.isLoading && (
        <div className="card enter enter-2 px-6 py-10 text-center">
          <IconUsers size={28} className="mx-auto text-ink-3" />
          <p className="mt-3 text-body text-ink-2">{t('consent.empty')}</p>
        </div>
      )}

      <ul className="enter enter-2 space-y-3">
        {active.map((grant) => (
          <li key={grant.id} className="card p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-body-lg font-medium text-ink">{grantRecipientLabel(grant, lang)}</p>
                <p className="mt-0.5 text-meta text-ink-3">
                  {grant.recipient_type === 'DEPARTMENT'
                    ? lang === 'ur'
                      ? 'محکمہ'
                      : 'Department'
                    : lang === 'ur'
                      ? 'مددگار'
                      : 'Helper'}
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-meta font-medium text-positive">
                <span aria-hidden className="live-dot bg-positive" />
                {t('consent.statusActive')}
              </span>
            </div>

            <dl className="mt-4 space-y-2.5 border-t border-ink/[0.08] pt-4 text-caption">
              <div>
                <dt className="text-meta text-ink-3">{t('consent.categories')}</dt>
                <dd className="mt-0.5 text-ink">
                  {grant.categories
                    .map((cat) => (lang === 'ur' ? CATEGORY_LABELS[cat]?.ur : CATEGORY_LABELS[cat]?.en) ?? cat)
                    .join(' · ')}
                </dd>
              </div>
              <div>
                <dt className="text-meta text-ink-3">{t('consent.purpose')}</dt>
                <dd className="mt-0.5 text-ink">
                  {grant.purposes
                    .map((p) => (lang === 'ur' ? PURPOSE_LABELS[p]?.ur : PURPOSE_LABELS[p]?.en) ?? p)
                    .join(' · ')}
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-8 gap-y-2.5">
                <div>
                  <dt className="text-meta text-ink-3">{t('consent.grantedOn')}</dt>
                  <dd className="num mt-0.5 text-ink">
                    <bdi>{dayMonth(grant.granted_at, lang)}</bdi>
                  </dd>
                </div>
                <div>
                  <dt className="text-meta text-ink-3">{t('consent.expiresOn')}</dt>
                  <dd className="num mt-0.5 text-ink">
                    <bdi>{dayMonth(grant.expires_at, lang)}</bdi>
                  </dd>
                </div>
              </div>
            </dl>

            <button
              type="button"
              onClick={() => setPendingWithdraw(grant)}
              className="press -ms-2 mt-4 inline-flex min-h-tap items-center gap-2 rounded-control px-2 text-caption font-medium text-negative hover:bg-negative-wash"
            >
              <IconLock size={16} />
              {t('consent.withdraw')}
            </button>
          </li>
        ))}
      </ul>

      {inactive.length > 0 && (
        <section className="enter enter-3 mt-6">
          <h2 className="section-label mb-3">{t('consent.statusWithdrawn')}</h2>
          <ul className="border-y border-ink/[0.08]">
            {inactive.map((grant) => (
              <li
                key={grant.id}
                className="flex items-center gap-2.5 border-b border-ink/[0.08] py-2.5 last:border-b-0"
              >
                <IconCross size={14} className="shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1 truncate text-caption text-ink-2">
                  {grantRecipientLabel(grant, lang)}
                </span>
                <span className="shrink-0 text-meta text-ink-3">
                  {(lang === 'ur' ? INACTIVE_LABELS[grant.status]?.ur : INACTIVE_LABELS[grant.status]?.en) ??
                    grant.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="enter enter-4 mt-6">
        <div className="mb-3 flex items-center gap-3">
          <h2 className="section-label flex-1">{t('consent.accessLog')}</h2>
          <AudioButton
            audioKey="consent_access_log"
            text={t('consent.accessLog')}
            variant="quiet"
          />
        </div>
        <ul className="border-y border-ink/[0.08]">
          {logs.data?.items.map((log) => (
            <li key={log.id} className="flex items-start gap-2.5 border-b border-ink/[0.08] py-2.5 last:border-b-0">
              <span
                aria-hidden
                className={`mt-1.5 live-dot ${log.allowed ? 'bg-positive' : 'bg-negative'}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-caption font-medium text-ink">{log.actor_label}</p>
                <p className="mt-0.5 text-meta text-ink-3">
                  {(lang === 'ur' ? CATEGORY_LABELS[log.category]?.ur : CATEGORY_LABELS[log.category]?.en) ??
                    log.category}
                  {' · '}
                  <bdi className="date">{stamp(log.created_at, lang)}</bdi>
                </p>
              </div>
              <span
                className={`shrink-0 text-meta font-medium ${log.allowed ? 'text-positive' : 'text-negative'}`}
              >
                {log.allowed ? t('consent.allowed') : t('consent.blocked')}
              </span>
            </li>
          ))}
          {logs.data?.items.length === 0 && <li className="py-2.5 text-meta text-ink-3">—</li>}
        </ul>
      </section>

      <Link
        to="/c/my-data"
        className="mt-8 block text-center text-caption font-medium text-accent-ink underline decoration-1 underline-offset-4"
      >
        {t('consent.myData')}
      </Link>

      {pendingWithdraw && (
        <div
          className="fixed inset-0 z-50 grid place-items-end bg-ink/40 sm:place-items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="withdraw-title"
        >
          <div className="enter w-full max-w-[520px] rounded-t-panel border border-ink/[0.08] bg-card p-5 sm:rounded-panel">
            <div className="flex items-start justify-between gap-3">
              <h2 id="withdraw-title" className="text-lead font-medium leading-[1.4] text-ink">
                {t('consent.withdrawConfirm')}
              </h2>
              <AudioButton text={pendingWithdraw.recipient_type === 'DEPARTMENT'
                ? 'اگر آپ محکمے کی اجازت واپس لیں گی تو آپ کی جاری درخواست روک دی جائے گی۔'
                : 'کیا آپ واقعی اجازت واپس لینا چاہتی ہیں؟'} />
            </div>
            {pendingWithdraw.recipient_type === 'DEPARTMENT' && (
              <p className="mt-3 rounded-control bg-warn-wash px-3 py-2.5 text-caption leading-[1.7] text-warn">
                {t('consent.withdrawDeptWarning')}
              </p>
            )}
            <div className="mt-5 space-y-2">
              <TapButton
                variant="danger"
                block
                onClick={() =>
                  withdraw.mutate({
                    grant: pendingWithdraw,
                    confirmCaseHold: pendingWithdraw.recipient_type === 'DEPARTMENT',
                  })
                }
                disabled={withdraw.isPending}
              >
                {pendingWithdraw.recipient_type === 'DEPARTMENT'
                  ? t('consent.withdrawDeptConfirm')
                  : t('consent.withdraw')}
              </TapButton>
              <TapButton variant="secondary" block onClick={() => setPendingWithdraw(null)}>
                {t('common.cancel')}
              </TapButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

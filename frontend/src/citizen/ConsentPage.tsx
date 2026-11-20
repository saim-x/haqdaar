import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../shared/api/client';
import { errorMessage } from '../shared/api/errors';
import type { ConsentAccessLog, ConsentGrant } from '../shared/api/types';
import { useI18n } from '../shared/i18n/I18nProvider';
import { AudioButton } from '../shared/ui/AudioButton';
import { TapButton } from '../shared/ui/TapButton';
import { IconCheck, IconCross, IconLock, IconUsers } from '../shared/ui/Icons';

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

function fmtDate(iso: string | null, lang: 'ur' | 'en'): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(lang === 'ur' ? 'ur-PK' : 'en-PK', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Consent Center — docs/11 §3.3, F-11.
 * Grant cards, the department-withdrawal warning (AC-11.3), and the access log
 * that shows BLOCKED attempts too (AC-11.2).
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
      <header className="mb-4 mt-1 flex items-start justify-between gap-3">
        <div>
          <h1 className="screen-title">{t('consent.title')}</h1>
          <p className="screen-hint">{t('consent.whoHasData')}</p>
        </div>
        <AudioButton audioKey="consent_intro" text={t('consent.whoHasData')} />
      </header>

      {error && (
        <div role="alert" className="mb-3 rounded-2xl border-2 border-[#B42318]/40 bg-[#B42318]/10 px-4 py-3 text-sm font-semibold text-[#B42318]">
          {error}
        </div>
      )}

      {grants.isLoading && <p className="text-sm text-ink-soft">{t('common.loading')}</p>}

      {active.length === 0 && !grants.isLoading && (
        <div className="card p-6 text-center">
          <IconUsers size={36} className="mx-auto text-ink-soft" />
          <p className="mt-2 text-sm text-ink-soft">{t('consent.empty')}</p>
        </div>
      )}

      <ul className="space-y-3">
        {active.map((grant) => (
          <li key={grant.id} className="card p-4">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold text-ink">
                  {lang === 'ur' ? grant.recipient_label_ur ?? grant.recipient_label : grant.recipient_label}
                </p>
                <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-teal-700">
                  {grant.recipient_type === 'DEPARTMENT' ? (lang === 'ur' ? 'محکمہ' : 'Department') : lang === 'ur' ? 'مددگار' : 'Helper'}
                </p>
              </div>
              <span className="rounded-full bg-[#0F7B3F]/10 px-2 py-0.5 text-[10px] font-bold text-[#0F7B3F]">
                {t('consent.statusActive')}
              </span>
            </div>

            <dl className="mt-3 space-y-1.5 text-xs">
              <div>
                <dt className="font-semibold text-ink-soft">{t('consent.categories')}</dt>
                <dd className="mt-0.5 flex flex-wrap gap-1">
                  {grant.categories.map((cat) => (
                    <span key={cat} className="rounded bg-ink/5 px-1.5 py-0.5 text-[11px] font-semibold text-ink-soft">
                      {lang === 'ur' ? CATEGORY_LABELS[cat]?.ur ?? cat : CATEGORY_LABELS[cat]?.en ?? cat}
                    </span>
                  ))}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink-soft">{t('consent.purpose')}</dt>
                <dd className="mt-0.5 text-ink">
                  {grant.purposes
                    .map((p) => (lang === 'ur' ? PURPOSE_LABELS[p]?.ur ?? p : PURPOSE_LABELS[p]?.en ?? p))
                    .join(' · ')}
                </dd>
              </div>
              <div className="flex gap-4 text-[11px] text-ink-soft">
                <span>
                  {t('consent.since')} <span className="num">{fmtDate(grant.granted_at, lang)}</span>
                </span>
                <span>
                  {t('consent.until')} <span className="num">{fmtDate(grant.expires_at, lang)}</span>
                </span>
              </div>
            </dl>

            <TapButton
              variant="danger"
              size="tap"
              block
              className="mt-3"
              onClick={() => setPendingWithdraw(grant)}
              icon={<IconLock size={18} />}
            >
              {t('consent.withdraw')}
            </TapButton>
          </li>
        ))}
      </ul>

      {inactive.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 text-sm font-bold text-ink-soft">{t('consent.statusWithdrawn')}</h2>
          <ul className="space-y-2">
            {inactive.map((grant) => (
              <li key={grant.id} className="card flex items-center gap-2 p-3 opacity-70">
                <IconCross size={16} className="text-[#B42318]" />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {lang === 'ur' ? grant.recipient_label_ur ?? grant.recipient_label : grant.recipient_label}
                </span>
                <span className="text-[10px] font-bold uppercase text-ink-soft">{grant.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink">{t('consent.accessLog')}</h2>
          <AudioButton audioKey="consent_access_log" text={t('consent.accessLog')} />
        </div>
        <ul className="space-y-2">
          {logs.data?.items.map((log) => (
            <li key={log.id} className="card flex items-start gap-2 p-3">
              <span
                className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${
                  log.allowed ? 'bg-[#0F7B3F]/10 text-[#0F7B3F]' : 'bg-[#B42318]/10 text-[#B42318]'
                }`}
              >
                {log.allowed ? <IconCheck size={14} /> : <IconCross size={14} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">
                  {lang === 'ur' ? log.actor_label_ur ?? log.actor_label : log.actor_label}
                </p>
                <p className="text-[11px] text-ink-soft">
                  {lang === 'ur' ? CATEGORY_LABELS[log.category]?.ur ?? log.category : CATEGORY_LABELS[log.category]?.en ?? log.category}
                  {' · '}
                  <span className="num">{new Date(log.created_at).toLocaleString()}</span>
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  log.allowed ? 'bg-[#0F7B3F]/10 text-[#0F7B3F]' : 'bg-[#B42318]/10 text-[#B42318]'
                }`}
              >
                {log.allowed ? t('consent.allowed') : t('consent.blocked')}
              </span>
            </li>
          ))}
          {logs.data?.items.length === 0 && <li className="text-xs text-ink-soft">—</li>}
        </ul>
      </section>

      <Link to="/c/my-data" className="mt-6 block text-center text-sm font-semibold text-teal-700">
        {t('consent.myData')}
      </Link>

      {pendingWithdraw && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-ink/50 p-0 sm:place-items-center sm:p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-[520px] rounded-t-3xl bg-white p-5 sm:rounded-3xl">
            <h2 className="text-lg font-bold text-ink">{t('consent.withdrawConfirm')}</h2>
            {pendingWithdraw.recipient_type === 'DEPARTMENT' && (
              <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold leading-relaxed text-amber-700">
                {t('consent.withdrawDeptWarning')}
              </p>
            )}
            <div className="mt-4 space-y-2">
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
                {pendingWithdraw.recipient_type === 'DEPARTMENT' ? t('consent.withdrawDeptConfirm') : t('consent.withdraw')}
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

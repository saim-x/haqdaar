import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Building2, ChevronLeft, ChevronRight, CircleCheck, Database, HandHeart, ShieldCheck, ShieldOff } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../shared/api/client';
import { cases, consent } from '../shared/api/endpoints';
import type { ConsentGrant } from '../shared/api/types';
import { currentCitizenId } from '../shared/auth/session';
import { useAuth } from '../shared/auth/store';
import { formatDateTime, useT, type DictKey } from '../shared/i18n';
import { OPEN_STATUSES } from '../shared/status';
import { AudioButton } from '../shared/ui/AudioButton';
import { Button } from '../shared/ui/Button';
import { cx } from '../shared/ui/cx';
import { Modal } from '../shared/ui/Modal';
import { PageLoader } from '../shared/ui/Spinner';
import { useAutoRead } from './useAutoRead';

/** Consent Center (docs/11 §3.3, Challenge 06): see, withdraw, and watch every access attempt. */
export function ConsentCenter() {
  const { t, lang, pick } = useT();
  const { user } = useAuth();
  const isHelper = user?.role === 'HELPER';
  const qc = useQueryClient();
  const citizenId = currentCitizenId();
  const grantsQ = useQuery({ queryKey: ['grants', citizenId], queryFn: consent.grants });
  const logsQ = useQuery({
    queryKey: ['access-logs', citizenId],
    queryFn: () => consent.accessLogs({ limit: 50 }),
    refetchInterval: 8000,
    enabled: !isHelper,
  });
  const casesQ = useQuery({ queryKey: ['cases', citizenId], queryFn: cases.list });
  const [target, setTarget] = useState<ConsentGrant | null>(null);
  const Chevron = lang === 'ur' ? ChevronLeft : ChevronRight;

  useAutoRead('consent_center', t('whoHasData'));

  const hasOpenCase = (casesQ.data ?? []).some((c) => OPEN_STATUSES.includes(c.status) && c.status !== 'DRAFT');
  const withdraw = useMutation({
    mutationFn: (g: ConsentGrant) => consent.withdraw(g.id, g.recipient_type === 'DEPARTMENT' && hasOpenCase),
    onSuccess: () => {
      setTarget(null);
      void qc.invalidateQueries({ queryKey: ['grants'] });
      void qc.invalidateQueries({ queryKey: ['access-logs'] });
      void qc.invalidateQueries({ queryKey: ['cases'] });
    },
  });
  const regrant = useMutation({
    mutationFn: (g: ConsentGrant) =>
      consent.grant({
        recipient_type: g.recipient_type,
        recipient_tenant_id: g.recipient_tenant_id,
        recipient_user_id: g.recipient_user_id,
        categories: g.categories,
        purposes: g.purposes,
        assurance_level: 'SELF_OTP',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['grants'] });
      void qc.invalidateQueries({ queryKey: ['cases'] });
    },
  });

  if (grantsQ.isLoading) return <PageLoader label={t('loading')} />;
  const grants = grantsQ.data ?? [];
  const active = grants.filter((g) => g.status === 'ACTIVE');
  const past = grants.filter((g) => g.status !== 'ACTIVE');
  const logs = logsQ.data ?? [];

  const GrantCard = ({ g }: { g: ConsentGrant }) => {
    const Icon = g.recipient_type === 'DEPARTMENT' ? Building2 : HandHeart;
    const isActive = g.status === 'ACTIVE';
    return (
      <li className={cx('card p-4', !isActive && 'opacity-80')}>
        <div className="flex items-start gap-3">
          <span className={cx('inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', isActive ? 'bg-consent-soft text-consent' : 'bg-muted text-muted-foreground')}>
            <Icon className="h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold">{g.recipient_label}</p>
            <p className="text-sm text-muted-foreground">
              {isActive ? (
                <span className="inline-flex items-center gap-1 font-semibold text-ok">
                  <CircleCheck className="h-4 w-4" aria-hidden />
                  {t('active')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-semibold text-muted-foreground">
                  <ShieldOff className="h-4 w-4" aria-hidden />
                  {g.status === 'EXPIRED' ? t('expired') : t('withdrawn')}
                </span>
              )}
              <span className="num ms-2">
                {t('since')} {formatDateTime(g.granted_at, lang)}
                {g.expires_at && isActive ? ` · ${t('until')} ${formatDateTime(g.expires_at, lang)}` : ''}
              </span>
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {g.categories.map((c) => (
                <span key={c} className="rounded-full bg-muted px-2.5 py-1 text-sm font-medium">
                  {t(`cat_${c}` as DictKey)}
                </span>
              ))}
            </div>
          </div>
          <AudioButton
            size="md"
            text={`${g.recipient_label}. ${g.categories.map((c) => t(`cat_${c}` as DictKey)).join('، ')}`}
            className="!h-10 !w-10"
          />
        </div>
        {!isHelper && (
          <div className="mt-4">
            {isActive ? (
              <Button variant="danger" size="lg" block icon={<Ban className="h-6 w-6" aria-hidden />} onClick={() => setTarget(g)}>
                {t('withdrawAccess')}
              </Button>
            ) : (
              <Button variant="secondary" size="md" block loading={regrant.isPending && regrant.variables?.id === g.id} onClick={() => regrant.mutate(g)}>
                {t('regrant')}
              </Button>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-6 animate-rise">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">{t('consentTitle')}</h1>
        <AudioButton clip="consent_center" text={t('whoHasData')} />
      </div>

      <section aria-labelledby="who-has" className="space-y-3">
        <h2 id="who-has" className="flex items-center gap-2 text-xl font-bold">
          <ShieldCheck className="h-6 w-6 text-consent" aria-hidden />
          {t('whoHasData')}
        </h2>
        <ul className="space-y-3">
          {active.map((g) => (
            <GrantCard key={g.id} g={g} />
          ))}
          {active.length === 0 && <li className="rounded-card border-2 border-dashed border-input p-5 text-center text-muted-foreground">—</li>}
        </ul>
        {past.length > 0 && (
          <details className="rounded-card border border-border bg-card p-3">
            <summary className="cursor-pointer font-semibold">
              {t('withdrawn')} / {t('expired')} ({past.length})
            </summary>
            <ul className="mt-3 space-y-3">
              {past.map((g) => (
                <GrantCard key={g.id} g={g} />
              ))}
            </ul>
          </details>
        )}
      </section>

      {!isHelper && (
        <section aria-labelledby="who-viewed" className="space-y-3">
          <h2 id="who-viewed" className="text-xl font-bold">
            {t('whoViewed')}
          </h2>
          {logs.length === 0 ? (
            <p className="rounded-card border-2 border-dashed border-input p-5 text-center text-muted-foreground">{t('noAccessYet')}</p>
          ) : (
            <ul className="card divide-y divide-border" aria-live="polite">
              {logs.map((l) => (
                <li key={l.id} className={cx('flex items-start gap-3 p-3', !l.allowed && 'bg-danger-soft')}>
                  {l.allowed ? (
                    <CircleCheck className="mt-0.5 h-6 w-6 shrink-0 text-ok" aria-hidden />
                  ) : (
                    <Ban className="mt-0.5 h-6 w-6 shrink-0 text-danger" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {l.actor_label}
                      <span className={cx('ms-2 rounded-full px-2 py-0.5 text-xs font-bold', l.allowed ? 'bg-ok-soft text-ok' : 'bg-danger text-white')}>
                        {l.allowed ? t('allowed') : t('blocked')}
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t(`cat_${l.category}` as DictKey)} · <span className="num">{formatDateTime(l.created_at, lang)}</span>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Link to="/c/my-data" className="card flex items-center gap-3 p-4 font-semibold">
        <Database className="h-6 w-6 text-info" aria-hidden />
        <span className="flex-1">{t('myData')}</span>
        <Chevron className="h-5 w-5 text-muted-foreground" aria-hidden />
      </Link>

      <Modal
        open={!!target}
        onClose={() => setTarget(null)}
        title={t('withdrawConfirmTitle')}
        closeLabel={t('close')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              {t('cancel')}
            </Button>
            <Button variant="danger" loading={withdraw.isPending} onClick={() => target && withdraw.mutate(target)}>
              {t('withdrawYes')}
            </Button>
          </>
        }
      >
        {target && (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <p className="flex-1 text-lg">{t('withdrawConfirmBody', { who: target.recipient_label })}</p>
              <AudioButton
                size="md"
                text={`${t('withdrawConfirmBody', { who: target.recipient_label })} ${target.recipient_type === 'DEPARTMENT' && hasOpenCase ? t('withdrawDeptWarning') : ''}`}
              />
            </div>
            {target.recipient_type === 'DEPARTMENT' && hasOpenCase && (
              <p className="rounded-control border-2 border-consent/40 bg-consent-soft p-3 font-semibold text-consent">{t('withdrawDeptWarning')}</p>
            )}
            {withdraw.error && <p className="text-danger">{pick((withdraw.error as ApiError).messageUr, withdraw.error.message)}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

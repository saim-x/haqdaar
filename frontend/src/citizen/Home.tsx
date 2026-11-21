import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../shared/api/client';
import { errorMessage } from '../shared/api/errors';
import type { CaseStatus, CaseView, Program } from '../shared/api/types';
import { useAuth } from '../shared/auth/AuthProvider';
import { useI18n } from '../shared/i18n/I18nProvider';
import { useLiteMode } from '../shared/lite/LiteModeProvider';
import { enqueue } from '../shared/offline/outbox';
import { AudioButton } from '../shared/ui/AudioButton';
import { StatusBadge } from '../shared/ui/StatusBadge';
import { TapButton } from '../shared/ui/TapButton';
import { IconChevron, IconList, IconQuestion, IconShield, IconUsers } from '../shared/ui/Icons';
import { uuid } from '../shared/lib/uuid';

/**
 * Where a case sits on the five-stage track the citizen actually understands.
 * The engine's 16 statuses collapse into these; the label still comes from
 * StatusBadge, so nothing is lost — only the position is simplified.
 */
const STAGE: Record<CaseStatus, number> = {
  DRAFT: 0,
  SUBMITTED: 1,
  PROCESSING: 2,
  WAITING_EXTERNAL: 2,
  NEEDS_INFO: 2,
  HUMAN_REVIEW: 3,
  IN_REVIEW: 3,
  PENDING_SECOND_APPROVAL: 3,
  ON_HOLD_CONSENT: 3,
  APPROVED: 4,
  PAYMENT_INITIATED: 4,
  PAID: 5,
  PAYMENT_FAILED: 4,
  REJECTED: 5,
  WITHDRAWN: 5,
  CLOSED: 5,
};

const TERMINAL: CaseStatus[] = ['PAID', 'REJECTED', 'WITHDRAWN', 'CLOSED'];

/**
 * Citizen Home — docs/11 §3.1.
 *
 * One lead surface and three quiet rows, not four equal tiles. The lead surface
 * is the only place the accent appears, and it answers the question the citizen
 * actually opens the app with: where is my application.
 */
export function CitizenHome() {
  const { t, lang, pick } = useI18n();
  const { session, actFor } = useAuth();
  const { lite } = useLiteMode();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const programs = useQuery({
    queryKey: ['programs'],
    queryFn: () => api.get<{ items: Program[] }>('/programs'),
    staleTime: 10 * 60 * 1000,
  });

  const cases = useQuery({
    queryKey: ['cases', 'home'],
    queryFn: () => api.get<{ items: CaseView[] }>('/cases'),
    staleTime: 30 * 1000,
    // Lite mode disables non-essential polling (docs/11 §2.7).
    refetchInterval: lite ? false : 60 * 1000,
  });

  const program = programs.data?.items[0];
  const activeCase = cases.data?.items.find((c) => !TERMINAL.includes(c.status));

  const startApplication = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (!program) {
        setError(t('home.noProgram'));
        return;
      }
      const created = await api.post<CaseView>('/cases', {
        program_id: program.id,
        case_type: 'BENEFIT_APPLICATION',
      });
      navigate(`/c/apply/${created.id}`);
    } catch (err) {
      // Offline: queue the case creation and continue with a local id so the
      // wizard still works. The outbox replays it exactly once on reconnect.
      const localId = uuid();
      try {
        await enqueue({
          method: 'POST',
          path: '/cases',
          body: { program_id: program?.id, case_type: 'BENEFIT_APPLICATION' },
          citizenId: actFor?.citizenId ?? session?.citizen?.id ?? null,
          actForCitizenId: actFor?.citizenId ?? null,
          label: t('home.newApplication'),
        });
        navigate(`/c/apply/${localId}?offline=1`);
      } catch {
        setError(errorMessage(err, lang));
      }
    } finally {
      setBusy(false);
    }
  }, [program, navigate, lang, actFor, session]);

  const displayName = actFor?.fullName ?? session?.citizen?.full_name ?? session?.user.full_name ?? '';
  // In helper mode the citizen's own CNIC is not in the act-for payload, so the
  // identity line shows the district instead — still enough to confirm who.
  const identity = actFor ? actFor.district : (session?.citizen?.cnic_masked ?? null);
  const programName = program ? pick(program.name_ur, program.name) : t('app.tagline');

  // Each row carries a line of its own. Without it the three rows are just the
  // tab bar again, one screen taller — the same four words in two places.
  const rows = [
    { key: 'cases', to: '/c/cases', label: t('home.cases'), hint: t('home.casesHint'), Icon: IconList },
    { key: 'scam', to: '/scam-check', label: t('home.scam'), hint: t('home.scamHint'), Icon: IconShield },
    { key: 'data', to: '/c/consent', label: t('home.data'), hint: t('home.dataHint'), Icon: IconUsers },
    { key: 'ask', to: '/c/ask', label: t('home.ask'), hint: t('home.askHint'), Icon: IconQuestion },
  ];

  return (
    <div className="screen">
      <header className="enter enter-1">
        <h1 className="text-title font-medium leading-[1.35] text-ink">{programName}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-ink-3">
          <span className="text-ink-2">{displayName}</span>
          {identity && (
            <>
              <span aria-hidden className="text-ink-3/60">
                ·
              </span>
              <span className="num font-mono">{identity}</span>
            </>
          )}
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="enter enter-2 mt-4 rounded-control border border-negative/25 bg-negative-wash px-4 py-3 text-caption font-medium text-negative"
        >
          {error}
        </div>
      )}

      {/* The lead surface. One accent, one primary action. */}
      <section className="card enter enter-2 mt-5 overflow-hidden">
        {activeCase ? (
          <>
            <div className="p-5">
              <p className="text-meta text-ink-3">{t('home.inProgress')}</p>
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <StatusBadge status={activeCase.status} size="lg" />
                <span className="num font-mono text-caption text-ink-3">{activeCase.reference_code}</span>
              </div>

              {/* The moment: a real five-stage track, filled from the start edge. */}
              <div className="mt-4 flex items-center gap-1" aria-hidden>
                {Array.from({ length: 5 }, (_, i) => {
                  const reached = i < STAGE[activeCase.status];
                  const current = i === STAGE[activeCase.status] - 1;
                  return (
                    <span
                      key={i}
                      className={`h-1 flex-1 rounded-full ${
                        current ? 'bg-accent' : reached ? 'bg-accent/35' : 'bg-ink/[0.10]'
                      }`}
                    />
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-2 border-t border-ink/[0.08] bg-raised/40 px-5 py-3">
              <TapButton size="tap" onClick={() => navigate(`/c/cases/${activeCase.id}`)} className="flex-1">
                {t('home.viewApplication')}
              </TapButton>
              <AudioButton audioKey="home_cases" text={t('home.cases')} />
            </div>
          </>
        ) : (
          <>
            <div className="p-5">
              <p className="text-meta text-ink-3">{t('home.apply')}</p>
              <p className="mt-1.5 text-body leading-[1.7] text-ink-2">{t('home.applyHint')}</p>
            </div>
            <div className="flex items-center gap-2 border-t border-ink/[0.08] bg-raised/40 px-5 py-3">
              <TapButton
                size="tap"
                onClick={() => void startApplication()}
                disabled={busy}
                className="flex-1"
                icon={busy ? undefined : <IconChevron size={16} />}
              >
                {busy ? t('common.loading') : t('home.startApplication')}
              </TapButton>
              <AudioButton audioKey="home_apply" text={t('home.apply')} />
            </div>
          </>
        )}
      </section>

      {/* Support rows. Same height, same gap, one icon column. */}
      <ul className="enter enter-3 mt-6 border-y border-ink/[0.08]">
        {rows.map(({ key, to, label, hint, Icon }) => (
          <li key={key} className="border-b border-ink/[0.08] last:border-b-0">
            <button
              type="button"
              onClick={() => navigate(to)}
              className="press flex min-h-primary w-full items-center gap-3 px-1 py-3 text-start hover:bg-raised/50"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-raised text-ink-2">
                <Icon size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium leading-[1.4] text-ink">{label}</span>
                <span className="mt-0.5 block text-caption leading-[1.5] text-ink-3">{hint}</span>
              </span>
              <IconChevron size={16} className="shrink-0 text-ink-3" />
            </button>
          </li>
        ))}
      </ul>

      {!lite && (
        <p className="enter enter-4 mt-6 text-caption leading-[1.7] text-ink-3">{t('home.offlineNote')}</p>
      )}
    </div>
  );
}

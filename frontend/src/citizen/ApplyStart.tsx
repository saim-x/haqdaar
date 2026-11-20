import { useQuery } from '@tanstack/react-query';
import { HandCoins } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cases, programs } from '../shared/api/endpoints';
import type { Program } from '../shared/api/types';
import { currentCitizenId } from '../shared/auth/session';
import { useT } from '../shared/i18n';
import { db } from '../shared/offline/db';
import { AudioButton } from '../shared/ui/AudioButton';
import { Button } from '../shared/ui/Button';
import { PageLoader } from '../shared/ui/Spinner';
import { createLocalDraft } from './wizard/draftActions';

/** Resumes an existing draft (local first, then server) or starts a new one. */
export function ApplyStart() {
  const { t, pick } = useT();
  const nav = useNavigate();
  const citizenId = currentCitizenId();
  const programsQ = useQuery({ queryKey: ['programs'], queryFn: programs.list, staleTime: 5 * 60_000 });
  const casesQ = useQuery({ queryKey: ['cases', citizenId], queryFn: cases.list });
  const [choosing, setChoosing] = useState(false);
  const started = useRef(false);
  const [params] = useSearchParams();
  const reopenCaseId = params.get('case');

  const start = async (program: Program) => {
    const serverDraft = casesQ.data?.find((c) => c.status === 'DRAFT' && (c.program.id === program.id || c.program.code === program.code));
    let full;
    if (serverDraft) {
      try {
        full = await cases.get(serverDraft.id);
      } catch {
        full = undefined;
      }
    }
    const localId = await createLocalDraft(program, full);
    nav(`/c/apply/${localId}`, { replace: true });
  };

  useEffect(() => {
    if (started.current || !citizenId) return;
    void (async () => {
      // NEEDS_INFO: reopen the submitted case so the citizen can add what is missing.
      if (reopenCaseId) {
        if (!programsQ.data) return;
        started.current = true;
        const existing = (await db.drafts.where('serverCaseId').equals(reopenCaseId).toArray())[0];
        if (existing) {
          await db.drafts.update(existing.localId, { submittedLocally: false, wizardStep: 'review' });
          nav(`/c/apply/${existing.localId}`, { replace: true });
          return;
        }
        const full = await cases.get(reopenCaseId);
        const program = programsQ.data.find((p) => p.id === full.program.id || p.code === full.program.code);
        if (!program) return;
        const localId = await createLocalDraft(program, { ...full, wizard_step: 'review' });
        nav(`/c/apply/${localId}`, { replace: true });
        return;
      }
      const local = (await db.drafts.where('citizenId').equals(citizenId).toArray())
        .filter((d) => !d.submittedLocally)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (local) {
        started.current = true;
        nav(`/c/apply/${local.localId}`, { replace: true });
        return;
      }
      if (!programsQ.data || casesQ.isLoading) return;
      if (programsQ.data.length === 1) {
        started.current = true;
        await start(programsQ.data[0]);
      } else {
        setChoosing(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citizenId, programsQ.data, casesQ.isLoading, reopenCaseId]);

  if (!choosing) return <PageLoader label={t('loading')} />;

  return (
    <div className="space-y-4 animate-rise">
      <h1 className="text-2xl font-bold">{t('tileApply')}</h1>
      {programsQ.data?.map((p) => (
        <div key={p.id} className="card flex items-start gap-3 p-4">
          <HandCoins className="mt-1 h-9 w-9 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold">{pick(p.name_ur, p.name)}</h2>
            <p className="mt-1 text-muted-foreground">{pick(p.description_ur, p.description)}</p>
            <Button className="mt-3" size="lg" onClick={() => void start(p)}>
              {t('tileApply')}
            </Button>
          </div>
          <AudioButton text={`${pick(p.name_ur, p.name)}. ${pick(p.description_ur, p.description)}`} size="md" />
        </div>
      ))}
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FilePlus2, FolderOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cases } from '../shared/api/endpoints';
import { currentCitizenId } from '../shared/auth/session';
import { formatDateTime, formatPkr, useT } from '../shared/i18n';
import { AudioButton } from '../shared/ui/AudioButton';
import { Button } from '../shared/ui/Button';
import { PageLoader } from '../shared/ui/Spinner';
import { StatusBadge } from '../shared/ui/StatusBadge';
import { STATUS } from '../shared/status';

export function CasesList() {
  const { t, pick, lang } = useT();
  const citizenId = currentCitizenId();
  const q = useQuery({ queryKey: ['cases', citizenId], queryFn: cases.list });
  const Chevron = lang === 'ur' ? ChevronLeft : ChevronRight;

  if (q.isLoading) return <PageLoader label={t('loading')} />;
  const list = (q.data ?? []).filter((c) => c.status !== 'DRAFT');

  return (
    <div className="space-y-4 animate-rise">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">{t('tileCases')}</h1>
        <AudioButton clip="tile_cases" text={t('tileCases')} />
      </div>

      {list.length === 0 ? (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-5 rounded-card border-2 border-dashed border-input p-8 text-center">
          <FolderOpen className="h-16 w-16 text-muted-foreground" aria-hidden />
          <p className="max-w-xs text-lg">{t('noCases')}</p>
          <Link to="/c/apply">
            <Button size="xl" icon={<FilePlus2 className="h-7 w-7" aria-hidden />}>
              {t('tileApply')}
            </Button>
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((c) => (
            <li key={c.id} className="relative">
              <Link to={`/c/cases/${c.id}`} className="card flex items-center gap-3 p-4 pe-20">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{pick(c.program.name_ur, c.program.name)}</p>
                  <p className="num text-sm text-muted-foreground">
                    {c.reference_code} · {formatDateTime(c.updated_at ?? c.created_at, lang)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusBadge status={c.status} />
                    {c.approved_amount_pkr ? <span className="font-bold text-ok">{formatPkr(c.approved_amount_pkr, lang)}</span> : null}
                    {c.case_type === 'COMPLAINT' && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{t('moneyNotReceived')}</span>
                    )}
                  </div>
                </div>
                <Chevron className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
              <div className="absolute end-10 top-1/2 -translate-y-1/2">
                <AudioButton clip={STATUS[c.status].clip} text={t(STATUS[c.status].label)} size="md" className="!h-10 !w-10" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { liveQuery } from 'dexie';
import { ChevronLeft, ChevronRight, FilePlus2, FolderOpen, MessageCircleQuestion, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cases } from '../shared/api/endpoints';
import { currentCitizenId } from '../shared/auth/session';
import { useAuth } from '../shared/auth/store';
import { useT } from '../shared/i18n';
import { db, type DraftRow } from '../shared/offline/db';
import { OPEN_STATUSES } from '../shared/status';
import { AudioButton } from '../shared/ui/AudioButton';
import { cx } from '../shared/ui/cx';
import { StatusBadge } from '../shared/ui/StatusBadge';
import { useAutoRead } from './useAutoRead';

function Tile({
  to,
  label,
  clip,
  icon,
  tone,
  lead,
  wide,
}: {
  to: string;
  label: string;
  clip: string;
  icon: ReactNode;
  tone: string;
  lead?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={cx('relative', (lead || wide) && 'col-span-2')}>
      <Link
        to={to}
        className={cx(
          'flex h-full flex-col justify-between rounded-card border-2 p-4 shadow-card transition-transform duration-fast active:scale-[0.98]',
          tone,
          lead ? 'min-h-[168px]' : 'min-h-[150px]',
        )}
      >
        <span className={cx('inline-flex items-center justify-center rounded-2xl', lead ? 'h-16 w-16' : 'h-14 w-14')}>{icon}</span>
        <span className={cx('block font-bold leading-snug', lead ? 'text-2xl pe-16' : 'text-lg pe-12')}>{label}</span>
      </Link>
      <div className="absolute bottom-3 end-3">
        <AudioButton clip={clip} text={label} size="md" label={label} />
      </div>
    </div>
  );
}

export function CitizenHome() {
  const { t, pick } = useT();
  const { user, actingFor } = useAuth();
  const citizenId = currentCitizenId();
  const [drafts, setDrafts] = useState<DraftRow[]>([]);

  const casesQ = useQuery({ queryKey: ['cases', citizenId], queryFn: cases.list });

  useEffect(() => {
    if (!citizenId) return;
    const sub = liveQuery(() => db.drafts.where('citizenId').equals(citizenId).toArray()).subscribe({
      next: (rows) => setDrafts(rows.filter((r) => !r.submittedLocally).sort((a, b) => b.updatedAt - a.updatedAt)),
    });
    return () => sub.unsubscribe();
  }, [citizenId]);

  useAutoRead('home_intro', t('homeAudio'));

  const name = actingFor?.name ?? user?.full_name ?? '';
  const latest = casesQ.data?.find((c) => c.case_type === 'BENEFIT_APPLICATION' && c.status !== 'DRAFT') ?? casesQ.data?.[0];
  const openCase = casesQ.data?.find((c) => OPEN_STATUSES.includes(c.status) && c.status !== 'DRAFT');
  const draft = drafts[0];
  const Chevron = document.documentElement.dir === 'rtl' ? ChevronLeft : ChevronRight;

  return (
    <div className="space-y-5 animate-rise">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-muted">{t('homeGreeting', { name: name.split(' ')[0] || '' })}</p>
          <h1 className="text-3xl font-bold leading-tight">{t('appName')}</h1>
        </div>
        <AudioButton clip="home_intro" text={t('homeAudio')} />
      </div>

      {draft && (
        <Link
          to={`/c/apply/${draft.localId}`}
          className="flex items-center gap-3 rounded-card border-2 border-warn/50 bg-warn-soft p-4 font-semibold"
        >
          <FilePlus2 className="h-7 w-7 shrink-0 text-warn" aria-hidden />
          <span className="flex-1">{t('continueDraft')}</span>
          <Chevron className="h-5 w-5" aria-hidden />
        </Link>
      )}

      {latest && (
        <Link to={`/c/cases/${latest.id}`} className="card flex items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted">{t('latestStatus')}</p>
            <p className="truncate font-semibold">{pick(latest.program.name_ur, latest.program.name)}</p>
            <StatusBadge status={latest.status} className="mt-2" />
          </div>
          <Chevron className="h-5 w-5 shrink-0 text-muted" aria-hidden />
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Tile
          lead
          to={openCase ? `/c/cases/${openCase.id}` : '/c/apply'}
          label={openCase ? t('tileCases') : t('tileApply')}
          clip={openCase ? 'tile_cases' : 'tile_apply'}
          tone="border-brand bg-brand text-brand-ink"
          icon={<FilePlus2 className="h-12 w-12" aria-hidden />}
        />
        <Tile
          to={openCase ? '/c/apply' : '/c/cases'}
          label={openCase ? t('tileApply') : t('tileCases')}
          clip={openCase ? 'tile_apply' : 'tile_cases'}
          tone="border-line bg-surface text-ink"
          icon={<FolderOpen className="h-10 w-10 text-info" aria-hidden />}
        />
        <Tile
          to="/scam-check"
          label={t('tileScam')}
          clip="tile_scam"
          tone="border-line bg-surface text-ink"
          icon={<ShieldQuestion className="h-10 w-10 text-accent" aria-hidden />}
        />
        <Tile
          to="/c/consent"
          label={t('tileData')}
          clip="tile_data"
          wide
          tone="border-line bg-surface text-ink"
          icon={<ShieldCheck className="h-10 w-10 text-consent" aria-hidden />}
        />
      </div>

      <Link
        to="/c/ask"
        className="fixed bottom-5 start-1/2 z-30 inline-flex min-h-tap-lg -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-6 text-lg font-semibold text-page shadow-lift rtl:translate-x-1/2"
      >
        <MessageCircleQuestion className="h-6 w-6" aria-hidden />
        {t('askQuestion')}
      </Link>
    </div>
  );
}

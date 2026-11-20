import { useQuery } from '@tanstack/react-query';
import { liveQuery } from 'dexie';
import { ChevronLeft, ChevronRight, FilePlus2, FolderOpen, MessageCircleQuestion, PenLine, ShieldCheck, ShieldQuestion, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { cases } from '../shared/api/endpoints';
import { currentCitizenId } from '../shared/auth/session';
import { useAuth } from '../shared/auth/store';
import { useT } from '../shared/i18n';
import { db, type DraftRow } from '../shared/offline/db';
import { OPEN_STATUSES, STATUS, toneClasses } from '../shared/status';
import { AjrakPattern } from '../shared/ui/AjrakPattern';
import { AudioButton } from '../shared/ui/AudioButton';
import { useAutoRead } from './useAutoRead';

/** Tactile pictogram tile: chunky bottom edge that presses down, tinted icon well, audio label. */
function Tile({ to, label, clip, icon: Icon, well, tint, wide }: { to: string; label: string; clip: string; icon: LucideIcon; well: string; tint: string; wide?: boolean }) {
  return (
    <div className="relative">
      <Link
        to={to}
        className={cn(
          'flex h-full rounded-3xl border-2 border-b-[6px] p-4 transition-transform duration-fast active:translate-y-[3px] active:border-b-2',
          wide ? 'min-h-[96px] flex-row items-center gap-4' : 'min-h-[156px] flex-col justify-between',
          tint,
        )}
      >
        <span className={cn('inline-flex h-14 w-14 items-center justify-center rounded-2xl', well)}>
          <Icon className="h-8 w-8" aria-hidden />
        </span>
        <span className="block pe-12 text-lg font-bold leading-snug">{label}</span>
      </Link>
      <div className={cn('absolute end-3', wide ? 'top-1/2 -translate-y-1/2' : 'bottom-4')}>
        <AudioButton clip={clip} text={label} size="md" label={label} className="!h-11 !w-11" />
      </div>
    </div>
  );
}

export function CitizenHome() {
  const { t, pick, lang } = useT();
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
  const firstName = name.replace(/^(Mst\.?|Mrs\.?)\s+/i, '').split(' ')[0] ?? '';
  const latest = casesQ.data?.find((c) => c.case_type === 'BENEFIT_APPLICATION' && c.status !== 'DRAFT');
  const openCase = casesQ.data?.find((c) => OPEN_STATUSES.includes(c.status) && c.status !== 'DRAFT');
  const draft = drafts[0];
  const Chevron = lang === 'ur' ? ChevronLeft : ChevronRight;
  const meta = latest ? STATUS[latest.status] : null;
  const tone = meta ? toneClasses[meta.tone] : null;

  // The hero changes with the citizen's situation: continue a draft, follow a case, or start.
  const hero = draft
    ? { to: `/c/apply/${draft.localId}`, title: t('continueDraft'), sub: t('savedLocally'), icon: PenLine, clip: 'continue_draft' }
    : openCase
      ? { to: `/c/cases/${openCase.id}`, title: t('tileCases'), sub: t(STATUS[openCase.status].label), icon: FolderOpen, clip: 'tile_cases' }
      : { to: '/c/apply', title: t('tileApply'), sub: pick('سہارا بیوہ امدادی گرانٹ', 'Sahara Widow Support Grant'), icon: FilePlus2, clip: 'tile_apply' };

  return (
    <div className="space-y-5 animate-rise">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-highlight/15 text-xl font-bold text-highlight" aria-hidden>
          {firstName.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">{lang === 'ur' ? 'السلام علیکم' : 'Assalam-o-Alaikum'}</p>
          <h1 className="truncate text-2xl font-bold leading-tight">{firstName}</h1>
        </div>
        <AudioButton clip="home_intro" text={t('homeAudio')} />
      </div>

      {/* Lead action */}
      <div className="relative">
        <Link
          to={hero.to}
          className="relative block overflow-hidden rounded-3xl border-b-[6px] border-[rgb(var(--action-primary-press))] bg-primary p-5 text-primary-foreground transition-transform duration-fast active:translate-y-[3px] active:border-b-2"
        >
          <AjrakPattern className="text-white/[0.08]" />
          <span className="relative flex items-start gap-4">
            <span className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
              <hero.icon className="h-9 w-9" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 pe-12 pt-1">
              <span className="block text-2xl font-bold leading-tight">{hero.title}</span>
              <span className="mt-1 block text-white/85">{hero.sub}</span>
            </span>
          </span>
        </Link>
        <div className="absolute end-4 top-4">
          <AudioButton clip={hero.clip} text={`${hero.title}. ${hero.sub}`} size="md" className="!h-11 !w-11 !border-white/40 !bg-white/15 !text-white" />
        </div>
      </div>

      {latest && meta && tone && (
        <Link to={`/c/cases/${latest.id}`} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5">
          <span className={cn('inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', tone.soft, tone.text)}>
            <meta.icon className="h-6 w-6" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-muted-foreground">{t('latestStatus')}</span>
            <span className={cn('block truncate font-bold', tone.text)}>{t(meta.label)}</span>
          </span>
          <Chevron className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3">
        {openCase || draft ? (
          <Tile to="/c/apply" label={t('tileApply')} clip="tile_apply" icon={FilePlus2} well="bg-primary-soft text-primary" tint="border-border bg-card" />
        ) : (
          <Tile to="/c/cases" label={t('tileCases')} clip="tile_cases" icon={FolderOpen} well="bg-info-soft text-info" tint="border-border bg-card" />
        )}
        <Tile to="/scam-check" label={t('tileScam')} clip="tile_scam" icon={ShieldQuestion} well="bg-warn-soft text-highlight" tint="border-border bg-card" />
        <div className="col-span-2">
          <Tile to="/c/consent" label={t('tileData')} clip="tile_data" icon={ShieldCheck} well="bg-consent-soft text-consent" tint="border-border bg-card" wide />
        </div>
      </div>

      <Link
        to="/c/ask"
        className="flex min-h-tap-lg items-center gap-3 rounded-2xl border-2 border-dashed border-input/50 px-4 py-3 font-semibold text-foreground hover:border-primary hover:text-primary"
      >
        <MessageCircleQuestion className="h-6 w-6 shrink-0" aria-hidden />
        <span className="flex-1">{t('askQuestion')}</span>
        <Chevron className="h-5 w-5" aria-hidden />
      </Link>
    </div>
  );
}

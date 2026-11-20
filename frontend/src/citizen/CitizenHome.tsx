import { useQuery } from '@tanstack/react-query';
import { liveQuery } from 'dexie';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  FolderOpen,
  HandHeart,
  HelpCircle,
  LockKeyhole,
  MessageCircleQuestion,
  ShieldCheck,
  ShieldQuestion,
  UserRound,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cases, me } from '../shared/api/endpoints';
import { currentCitizenId } from '../shared/auth/session';
import { useAuth } from '../shared/auth/store';
import { formatDateTime, useT } from '../shared/i18n';
import { db, type DraftRow } from '../shared/offline/db';
import { OPEN_STATUSES, STATUS, toneClasses } from '../shared/status';
import { useSettings } from '../shared/settings';
import { AudioButton } from '../shared/ui/AudioButton';
import { Modal } from '../shared/ui/Modal';
import { ServiceGuide } from '../shared/ui/ServiceGuide';
import { cx } from '../shared/ui/cx';
import { useAutoRead } from './useAutoRead';

function QuickAction({ to, label, icon: Icon }: { to: string; label: string; icon: LucideIcon }) {
  return (
    <Link to={to} className="quick-action group">
      <span className="quick-action-icon">
        <Icon className="h-6 w-6 transition-transform group-active:scale-90" strokeWidth={1.8} aria-hidden />
      </span>
      <span>{label}</span>
    </Link>
  );
}

export function CitizenHome() {
  const { t, pick, lang } = useT();
  const { user, actingFor } = useAuth();
  const { liteMode } = useSettings();
  const citizenId = currentCitizenId();
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [panel, setPanel] = useState<'help' | 'updates' | null>(null);
  const [category, setCategory] = useState<'support' | 'account'>('support');
  const casesQ = useQuery({ queryKey: ['cases', citizenId], queryFn: cases.list });
  const notificationsQ = useQuery({
    queryKey: ['notifications', citizenId],
    queryFn: me.notifications,
    enabled: panel === 'updates',
    staleTime: 30_000,
  });
  useEffect(() => {
    setDrafts([]);
    if (!citizenId) return;
    const sub = liveQuery(() => db.drafts.where('citizenId').equals(citizenId).toArray()).subscribe({
      next: (rows) =>
        setDrafts(rows.filter((r) => !r.submittedLocally).sort((a, b) => b.updatedAt - a.updatedAt)),
    });
    return () => sub.unsubscribe();
  }, [citizenId]);
  useAutoRead('home_intro', t('homeAudio'));
  const name = actingFor?.name ?? user?.full_name ?? '';
  const firstName = name.replace(/^(Mst\.?|Mrs\.?)\s+/i, '').split(' ')[0] ?? '';
  const latest = casesQ.data?.find((c) => c.case_type === 'BENEFIT_APPLICATION' && c.status !== 'DRAFT');
  const openCase = casesQ.data?.find((c) => OPEN_STATUSES.includes(c.status) && c.status !== 'DRAFT');
  const draft = drafts[0];
  const Arrow = lang === 'ur' ? ArrowLeft : ArrowRight;
  const Chevron = lang === 'ur' ? ChevronLeft : ChevronRight;
  const meta = latest ? STATUS[latest.status] : null;
  const tone = meta ? toneClasses[meta.tone] : null;
  const hero = draft
    ? {
        to: `/c/apply/${draft.localId}`,
        title: pick('آپ کی درخواست محفوظ ہے', 'Ready when you are'),
        sub: pick('محفوظ جواب کے ساتھ جاری رکھیں', 'Continue with your saved answers'),
        cta: pick('درخواست جاری رکھیں', 'Continue application'),
        clip: 'continue_draft',
      }
    : openCase
      ? {
          to: `/c/cases/${openCase.id}`,
          title: t(STATUS[openCase.status].label),
          sub: openCase.reference_code,
          cta: pick('تازہ صورتحال دیکھیں', 'View application'),
          clip: STATUS[openCase.status].clip,
        }
      : {
          to: '/c/apply',
          title: pick('سہارا، آپ کے خاندان کے لیے', 'Support for your family'),
          sub: pick('آواز اور آسان سوالات سے درخواست دیں', 'Apply with voice and simple questions'),
          cta: pick('درخواست شروع کریں', 'Start application'),
          clip: 'tile_apply',
        };
  const services =
    category === 'support'
      ? [
          {
            to: '/c/apply',
            title: pick('امداد کے لیے درخواست', 'Apply for support'),
            hint: pick('سہارا اور گزارہ پروگرام', 'Sahara & Guzara programmes'),
            icon: HandHeart,
          },
          {
            to: '/scam-check',
            title: pick('پیغام کی جانچ', 'Check a suspicious message'),
            hint: pick('متن، تصویر یا آواز سے جانچیں', 'Paste, upload or speak a message'),
            icon: ShieldQuestion,
          },
          {
            to: '/c/ask',
            title: pick('امدادی پالیسی کے بارے میں پوچھیں', 'Ask about a grant'),
            hint: pick('ذریعوں کے ساتھ جواب', 'Guidance with policy sources'),
            icon: MessageCircleQuestion,
          },
        ]
      : [
          {
            to: '/c/my-data',
            title: pick('میری معلومات', 'My information'),
            hint: pick('معلومات دیکھیں اور درست کریں', 'Review details and request corrections'),
            icon: UserRound,
          },
          {
            to: '/c/consent',
            title: pick('اجازت اور رسائی', 'Permissions & access'),
            hint: pick('دیکھیں کس نے معلومات دیکھیں', 'Choose who can see your information'),
            icon: LockKeyhole,
          },
          {
            to: '/c/cases',
            title: pick('درخواستوں کی تفصیل', 'Application history'),
            hint: pick('فیصلے، وجوہات اور اگلا قدم', 'Decisions, reasons and next steps'),
            icon: FolderOpen,
          },
        ];

  return (
    <div className="mobile-dashboard animate-rise">
      <div className="dashboard-greeting">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[3px] border-white bg-primary-soft text-lg font-bold text-primary shadow-sm"
          aria-hidden
        >
          {firstName.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{pick('السلام علیکم', 'Assalam-o-Alaikum')}</p>
          <h1 className="truncate text-xl font-bold tracking-tight">{firstName}</h1>
        </div>
        <button
          type="button"
          onClick={() => setPanel('updates')}
          aria-label={pick('میری تازہ خبریں', 'My updates')}
          className="app-icon-button"
        >
          <Bell className="h-5 w-5" aria-hidden />
        </button>
        <AudioButton clip="home_intro" text={t('homeAudio')} size="md" />
      </div>

      <section className="support-pass" aria-label={pick('آپ کی امداد', 'Your support')}>
        {!liteMode && (
          <svg
            aria-hidden
            className="pointer-events-none absolute -end-7 -top-4 h-56 w-56 text-white/[0.06]"
            viewBox="0 0 200 200"
            fill="none"
          >
            <circle cx="130" cy="70" r="100" stroke="currentColor" strokeWidth="28" />
            <circle cx="130" cy="70" r="58" stroke="currentColor" strokeWidth="18" />
            <path d="M55 200V90a45 45 0 0 1 90 0v110" stroke="currentColor" strokeWidth="18" />
          </svg>
        )}
        <div className="relative flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-[11px] font-medium text-white/80">
            <HandHeart className="h-4 w-4" aria-hidden />
            {pick('سہارا · خاندانی امداد', 'SAHARA · FAMILY SUPPORT')}
          </span>
          <span className="rounded-full border border-white/20 px-2 py-1 text-[10px] text-white/80">
            {pick('پروٹوٹائپ', 'Prototype')}
          </span>
        </div>
        <div className="relative mt-4 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[23px] font-bold leading-snug tracking-tight sm:text-3xl">{hero.title}</h2>
            <p className="mt-1 text-xs text-white/75 sm:text-sm">{hero.sub}</p>
          </div>
          <span
            className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-white/10 min-[370px]:inline-flex"
            aria-hidden
          >
            <HandHeart className="h-8 w-8" strokeWidth={1.5} />
          </span>
        </div>
        <div className="relative mt-5 flex items-center gap-3">
          <Link
            to={hero.to}
            className="flex min-h-12 flex-1 items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 text-sm font-bold text-primary transition-transform active:scale-[0.98]"
          >
            {hero.cta}
            <Arrow className="h-4 w-4 shrink-0" aria-hidden />
          </Link>
          <AudioButton
            clip={hero.clip}
            text={`${hero.title}. ${hero.sub}. ${hero.cta}`}
            size="md"
            className="!border-white/25 !bg-white/10 !text-white"
          />
        </div>
        <p className="relative mt-3 flex items-center gap-1.5 text-[10px] text-white/75">
          <ShieldCheck className="h-3 w-3" aria-hidden />
          {pick('کوئی درخواست فیس نہیں · جواب محفوظ رہتے ہیں', 'No application fee · Your progress is saved')}
        </p>
      </section>

      <section aria-label={pick('فوری کام', 'Quick actions')} className="quick-actions">
        <QuickAction to="/c/apply" label={pick('درخواست دیں', 'Apply')} icon={FilePlus2} />
        <QuickAction to="/c/cases" label={pick('درخواست دیکھیں', 'Track')} icon={FolderOpen} />
        <QuickAction to="/scam-check" label={pick('پیغام چیک', 'Check SMS')} icon={ShieldQuestion} />
        <QuickAction to="/c/ask" label={pick('سوال پوچھیں', 'Ask AI')} icon={MessageCircleQuestion} />
      </section>

      {casesQ.isError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-2xl border border-warn/20 bg-warn-soft p-3 text-xs"
        >
          <p className="flex-1">
            {pick(
              'تازہ صورتحال نہیں مل سکی۔ دوبارہ کوشش کریں۔',
              'Updates unavailable. Your local drafts are safe.',
            )}
          </p>
          <button
            type="button"
            onClick={() => void casesQ.refetch()}
            className="min-h-12 px-2 font-bold text-warn"
          >
            {t('retry')}
          </button>
        </div>
      )}
      {latest && meta && tone && (
        <Link
          to={`/c/cases/${latest.id}`}
          className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"
        >
          <span
            className={cx(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
              tone.soft,
              tone.text,
            )}
          >
            <meta.icon className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="text-[10px] text-muted-foreground">{t('latestStatus')}</span>
            <span className="block truncate text-sm font-bold">{t(meta.label)}</span>
          </span>
          <Chevron className="h-4 w-4 text-muted-foreground" aria-hidden />
        </Link>
      )}

      <section className="rounded-[20px] border border-border bg-card p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold tracking-tight">{pick('آپ کی خدمات', 'Your services')}</h2>
          <button
            type="button"
            onClick={() => setPanel('help')}
            className="flex min-h-12 items-center gap-1 text-xs font-semibold text-primary"
          >
            <HelpCircle className="h-4 w-4" aria-hidden />
            {pick('مدد', 'Help')}
          </button>
        </div>
        <div
          className="mb-2 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1"
          role="group"
          aria-label={pick('خدمات کی قسم', 'Service category')}
        >
          {(['support', 'account'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={category === value}
              onClick={() => setCategory(value)}
              className={cx(
                'min-h-12 rounded-lg px-2 text-xs font-semibold transition-colors',
                category === value ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground',
              )}
            >
              {value === 'support'
                ? pick('امداد اور رہنمائی', 'Support & guidance')
                : pick('میرا اکاؤنٹ', 'My account')}
            </button>
          ))}
        </div>
        <div className="divide-y divide-border">
          {services.map(({ to, title, hint, icon: Icon }) => (
            <Link key={to} to={to} className="group flex min-h-[76px] items-center gap-3 py-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                <Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold">{title}</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{hint}</span>
              </span>
              <Chevron
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform ltr:group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5"
                aria-hidden
              />
            </Link>
          ))}
        </div>
      </section>
      <button
        type="button"
        onClick={() => setPanel('help')}
        className="flex w-full items-center gap-3 rounded-2xl border border-primary/15 bg-primary-soft p-4 text-start"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-primary">
          <Volume2 className="h-5 w-5" aria-hidden />
        </span>
        <span className="flex-1">
          <span className="block text-sm font-bold text-primary">
            {pick('پہلی بار استعمال کر رہی ہیں؟', 'First time here?')}
          </span>
          <span className="text-xs text-muted-foreground">
            {pick('درخواست، آواز اور آف لائن مدد', 'Help with applying, voice and offline saving')}
          </span>
        </span>
        <Chevron className="h-4 w-4 text-primary" aria-hidden />
      </button>
      <p className="flex items-center justify-center gap-1.5 pb-1 text-[10px] text-muted-foreground">
        <LockKeyhole className="h-3 w-3" aria-hidden />
        {pick('فرضی ڈیٹا · آپ کی اجازت سے رسائی', 'Synthetic data · Access with your permission')}
      </p>

      <Modal
        open={panel === 'help'}
        onClose={() => setPanel(null)}
        title={pick('ہم آپ کے ساتھ ہیں', 'A little help, when you need it')}
        placement="sheet"
        closeLabel={t('close')}
      >
        <ServiceGuide />
        <Link
          to="/c/ask"
          className="mt-4 flex min-h-14 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-white"
        >
          <MessageCircleQuestion className="h-5 w-5" aria-hidden />
          {t('askQuestion')}
        </Link>
      </Modal>
      <Modal
        open={panel === 'updates'}
        onClose={() => setPanel(null)}
        title={pick('میری تازہ خبریں', 'My updates')}
        placement="sheet"
        closeLabel={t('close')}
      >
        {notificationsQ.isPending ? (
          <p role="status" className="p-6 text-center text-sm text-muted-foreground">
            {t('loading')}
          </p>
        ) : notificationsQ.isError ? (
          <div role="alert">
            <p className="text-sm">{pick('خبر نہیں مل سکی', 'Could not load updates.')}</p>
            <button
              type="button"
              onClick={() => void notificationsQ.refetch()}
              className="min-h-12 font-semibold text-primary"
            >
              {t('retry')}
            </button>
          </div>
        ) : !notificationsQ.data?.length ? (
          <div className="py-7 text-center">
            <Bell className="mx-auto h-9 w-9 text-primary" aria-hidden />
            <p className="mt-3 font-bold">{pick('ابھی کوئی نئی خبر نہیں', 'You’re all caught up')}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {pick('درخواست کی خبر یہاں ملے گی۔', 'Application updates will appear here.')}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {notificationsQ.data.map((note) => (
              <li key={note.id} className="py-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                    <Check className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold">{pick(note.title_ur, note.title_en)}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{pick(note.body_ur, note.body_en)}</p>
                    <p className="num mt-2 text-[10px] text-muted-foreground">
                      {formatDateTime(note.created_at, lang)}
                    </p>
                    {note.case_id && (
                      <Link
                        to={`/c/cases/${note.case_id}`}
                        onClick={() => setPanel(null)}
                        className="inline-flex min-h-12 items-center gap-2 text-xs font-bold text-primary"
                      >
                        {pick('درخواست دیکھیں', 'View application')}
                        <Arrow className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}

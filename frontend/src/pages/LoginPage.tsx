import { useMutation } from '@tanstack/react-query';
import {
  BadgeCheck,
  Building2,
  ChevronLeft,
  ChevronRight,
  Eye,
  HandHeart,
  Landmark,
  MessageSquareWarning,
  Settings2,
  ShieldCheck,
  Store,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../shared/api/client';
import { auth } from '../shared/api/endpoints';
import type { PersonaKey, TokenPayload } from '../shared/api/types';
import { completeLogin } from '../shared/auth/session';
import { homePathFor } from '../shared/auth/store';
import { langStore, useT } from '../shared/i18n';
import { Button } from '../shared/ui/Button';
import { cx } from '../shared/ui/cx';

interface Persona {
  key: PersonaKey;
  name: string;
  nameUr?: string;
  role: string;
  story: string;
  storyUr?: string;
  icon: LucideIcon;
}

// Seeded personas (docs/10 §2). All fictional.
const CITIZEN_PERSONAS: Persona[] = [
  {
    key: 'widow_fatima',
    name: 'Fatima Bibi',
    nameUr: 'فاطمہ بی بی',
    role: 'Citizen',
    story: 'Widow, Thatta. Cannot read, weak signal. Golden path.',
    storyUr: 'بیوہ، ٹھٹھہ۔ پڑھ نہیں سکتیں، کمزور سگنل۔',
    icon: UserRound,
  },
  {
    key: 'shopkeeper_rasool',
    name: 'Rasool Bakhsh',
    nameUr: 'رسول بخش',
    role: 'Citizen',
    story: 'Shopkeeper, Hyderabad. Gets fake relief SMS.',
    storyUr: 'دکاندار، حیدرآباد۔ جعلی امدادی پیغامات ملتے ہیں۔',
    icon: Store,
  },
  {
    key: 'helper_ayesha',
    name: 'Ayesha Khatoon',
    nameUr: 'عائشہ خاتون',
    role: 'Community helper',
    story: 'Serves many families from one shared phone.',
    storyUr: 'ایک فون سے کئی خاندانوں کی مدد کرتی ہیں۔',
    icon: HandHeart,
  },
];

const STAFF_PERSONAS: Persona[] = [
  { key: 'officer_sana', name: 'Sana Qureshi', role: 'Officer · SPD', story: 'Priority review queue, four-eyes first approver.', icon: BadgeCheck },
  { key: 'officer_imran', name: 'Imran Siddiqui', role: 'Officer · SPD', story: 'Second approver for high-risk cases.', icon: BadgeCheck },
  { key: 'admin_bilal', name: 'Bilal Ahmed', role: 'Admin · SPD', story: 'Rule editor, Digital Twin, users and API keys.', icon: Settings2 },
  { key: 'admin_platform', name: 'Platform Admin', role: 'Admin · Platform', story: 'Mock service chaos controls, jobs, demo reset.', icon: Building2 },
  { key: 'auditor_nadia', name: 'Nadia Farooq', role: 'Auditor', story: 'Read-only traces, consent records, chain verify.', icon: Eye },
  { key: 'officer_zakat', name: 'Tariq (Zakat)', role: 'Officer · ZWB', story: 'Other tenant: proves isolation.', icon: Landmark },
];

export function LoginPage() {
  const { t, lang, pick } = useT();
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from;
  const [mode, setMode] = useState<'demo' | 'phone' | 'staff'>('demo');
  const [phone, setPhone] = useState('+923001000001');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const Chevron = lang === 'ur' ? ChevronLeft : ChevronRight;

  const onTokens = async (tokens: TokenPayload) => {
    await completeLogin(tokens);
    const home = homePathFor(tokens.user.role);
    nav(from && from !== '/login' ? from : home, { replace: true });
  };
  const onError = (e: unknown) => setError(e instanceof ApiError ? pick(e.messageUr, e.message) : t('somethingWrong'));

  const demo = useMutation({ mutationFn: auth.demoLogin, onSuccess: onTokens, onError });
  const otpReq = useMutation({
    mutationFn: () => auth.otpRequest(phone.trim()),
    onSuccess: (r) => {
      setChallenge(r.challenge_id);
      setError(null);
    },
    onError,
  });
  const otpVerify = useMutation({ mutationFn: () => auth.otpVerify(challenge!, code.trim()), onSuccess: onTokens, onError });
  const staff = useMutation({ mutationFn: () => auth.login(email.trim(), password), onSuccess: onTokens, onError });

  const PersonaButton = ({ p, staffCard }: { p: Persona; staffCard?: boolean }) => (
    <button
      type="button"
      onClick={() => {
        setError(null);
        if (staffCard) langStore.set(lang);
        demo.mutate(p.key);
      }}
      disabled={demo.isPending}
      aria-busy={demo.isPending && demo.variables === p.key}
      className={cx(
        'group flex w-full items-center gap-3 rounded-card border border-line bg-surface p-3 text-start shadow-card transition-colors duration-fast hover:border-brand',
        'disabled:opacity-60',
      )}
    >
      <span className={cx('inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', staffCard ? 'bg-sunken text-ink' : 'bg-brand-soft text-brand')}>
        <p.icon className="h-6 w-6" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold leading-tight">
          {lang === 'ur' && p.nameUr ? p.nameUr : p.name}
          <span className="ms-2 text-xs font-medium text-muted">{p.role}</span>
        </span>
        <span className="mt-0.5 block text-sm text-muted">{lang === 'ur' && p.storyUr ? p.storyUr : p.story}</span>
      </span>
      <Chevron className="h-5 w-5 shrink-0 text-muted group-hover:text-brand" aria-hidden />
    </button>
  );

  const submitPhone = (e: FormEvent) => {
    e.preventDefault();
    if (challenge) otpVerify.mutate();
    else otpReq.mutate();
  };

  return (
    <div className="mx-auto max-w-xl px-4 pb-16 pt-8">
      <div className="mb-8">
        <div className="mb-5 flex items-center justify-between">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-brand-ink shadow-card" aria-hidden>
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M7 5v14M17 5v14M7 12h10" />
            </svg>
          </span>
          <button
            type="button"
            onClick={() => langStore.set(lang === 'ur' ? 'en' : 'ur')}
            className="min-h-tap rounded-full border border-line-strong px-4 text-sm font-semibold"
          >
            {t('switchLang')}
          </button>
        </div>
        <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">{t('loginTitle')}</h1>
        <p className="mt-3 text-lg text-muted">{t('loginSubtitle')}</p>
      </div>

      <Link
        to="/scam-check"
        className="mb-6 flex items-center gap-3 rounded-card border-2 border-accent/40 bg-warn-soft p-4 font-semibold text-ink hover:border-accent"
      >
        <MessageSquareWarning className="h-7 w-7 shrink-0 text-accent" aria-hidden />
        <span className="flex-1">{t('checkMessageNoLogin')}</span>
        <Chevron className="h-5 w-5 text-accent" aria-hidden />
      </Link>

      <div role="tablist" aria-label="Login method" className="mb-4 grid grid-cols-3 gap-1 rounded-control bg-sunken p-1">
        {(
          [
            ['demo', t('demoLogin')],
            ['phone', t('phoneLogin')],
            ['staff', t('staffLogin')],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={cx(
              'min-h-tap rounded-lg px-2 text-sm font-semibold leading-tight transition-colors duration-fast',
              mode === m ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-control border border-danger/40 bg-danger-soft p-3 font-medium text-danger">
          {error}
        </p>
      )}

      {mode === 'demo' && (
        <div className="space-y-6">
          <p className="flex items-start gap-2 text-sm text-muted">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {t('demoLoginHint')}
          </p>
          <section aria-label="Citizens and helper" className="space-y-2">
            {CITIZEN_PERSONAS.map((p) => (
              <PersonaButton key={p.key} p={p} />
            ))}
          </section>
          <section aria-label="Staff" className="space-y-2" dir="ltr" lang="en">
            <h2 className="pt-2 text-xs font-bold uppercase tracking-wider text-muted">Department staff & auditor</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {STAFF_PERSONAS.map((p) => (
                <PersonaButton key={p.key} p={p} staffCard />
              ))}
            </div>
          </section>
        </div>
      )}

      {mode === 'phone' && (
        <form onSubmit={submitPhone} className="card space-y-4 p-5">
          <label className="block">
            <span className="mb-1 block font-semibold">{t('phoneLabel')}</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              disabled={!!challenge}
              className="num min-h-tap-lg w-full rounded-control border-2 border-line-strong bg-surface px-4 text-xl"
            />
          </label>
          {challenge && (
            <label className="block">
              <span className="mb-1 block font-semibold">{t('codeLabel')}</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                autoFocus
                className="num min-h-tap-lg w-full rounded-control border-2 border-line-strong bg-surface px-4 text-center text-2xl tracking-[0.5em]"
              />
              <span className="mt-1 block text-sm text-muted">{t('smsHint')}</span>
            </label>
          )}
          <Button type="submit" size="lg" block loading={otpReq.isPending || otpVerify.isPending} disabled={!!challenge && code.length !== 6}>
            {challenge ? t('verifyCode') : t('sendCode')}
          </Button>
        </form>
      )}

      {mode === 'staff' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            staff.mutate();
          }}
          className="card space-y-4 p-5"
        >
          <label className="block">
            <span className="mb-1 block font-semibold">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              dir="ltr"
              required
              className="min-h-tap w-full rounded-control border-2 border-line-strong bg-surface px-4"
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-semibold">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              dir="ltr"
              required
              className="min-h-tap w-full rounded-control border-2 border-line-strong bg-surface px-4"
            />
          </label>
          <Button type="submit" size="lg" block loading={staff.isPending}>
            {lang === 'ur' ? 'لاگ ان' : 'Log in'}
          </Button>
        </form>
      )}
    </div>
  );
}

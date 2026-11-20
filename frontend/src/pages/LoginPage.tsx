import { useMutation } from '@tanstack/react-query';
import {
  AudioLines,
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
  UserCheck,
  UserRound,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { ApiError } from '../shared/api/client';
import { auth } from '../shared/api/endpoints';
import type { PersonaKey, TokenPayload } from '../shared/api/types';
import { completeLogin } from '../shared/auth/session';
import { homePathFor } from '../shared/auth/store';
import { langStore, useT } from '../shared/i18n';
import { AjrakPattern, HaqdaarMark } from '../shared/ui/AjrakPattern';
import { Button } from '../shared/ui/Button';

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
  { key: 'widow_fatima', name: 'Fatima Bibi', nameUr: 'فاطمہ بی بی', role: 'Citizen', story: 'Widow in Thatta. Cannot read, weak signal.', storyUr: 'بیوہ، ٹھٹھہ۔ پڑھ نہیں سکتیں، کمزور سگنل۔', icon: UserRound },
  { key: 'shopkeeper_rasool', name: 'Rasool Bakhsh', nameUr: 'رسول بخش', role: 'Citizen', story: 'Shopkeeper in Hyderabad. Gets fake relief SMS.', storyUr: 'دکاندار، حیدرآباد۔ جعلی امدادی پیغامات ملتے ہیں۔', icon: Store },
  { key: 'helper_ayesha', name: 'Ayesha Khatoon', nameUr: 'عائشہ خاتون', role: 'Helper', story: 'Serves many families from one shared phone.', storyUr: 'ایک فون سے کئی خاندانوں کی مدد کرتی ہیں۔', icon: HandHeart },
];

const STAFF_PERSONAS: Persona[] = [
  { key: 'officer_sana', name: 'Sana Qureshi', role: 'Officer · SPD', story: 'Priority queue, first approver', icon: BadgeCheck },
  { key: 'officer_imran', name: 'Imran Siddiqui', role: 'Officer · SPD', story: 'Second approver (four-eyes)', icon: UserCheck },
  { key: 'admin_bilal', name: 'Bilal Ahmed', role: 'Admin · SPD', story: 'Rules, Digital Twin, keys', icon: Settings2 },
  { key: 'admin_platform', name: 'Platform Admin', role: 'Admin · Platform', story: 'Chaos controls, demo reset', icon: Building2 },
  { key: 'auditor_nadia', name: 'Nadia Farooq', role: 'Auditor', story: 'Traces, consent, chain verify', icon: Eye },
  { key: 'officer_zakat', name: 'Tariq Mehmood', role: 'Officer · ZWB', story: 'Other tenant, proves isolation', icon: Landmark },
];

export function LoginPage() {
  const { t, lang, pick } = useT();
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from;
  const [phone, setPhone] = useState('+923001000001');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const Chevron = lang === 'ur' ? ChevronLeft : ChevronRight;

  const onTokens = async (tokens: TokenPayload) => {
    await completeLogin(tokens);
    nav(from && from !== '/login' ? from : homePathFor(tokens.user.role), { replace: true });
  };
  const onError = (e: unknown) => setError(e instanceof ApiError ? pick(e.messageUr, e.message) : t('somethingWrong'));

  const demo = useMutation({ mutationFn: auth.demoLogin, onSuccess: onTokens, onError });
  const otpReq = useMutation({ mutationFn: () => auth.otpRequest(phone.trim()), onSuccess: (r) => { setChallenge(r.challenge_id); setError(null); }, onError });
  const otpVerify = useMutation({ mutationFn: () => auth.otpVerify(challenge!, code.trim()), onSuccess: onTokens, onError });
  const staff = useMutation({ mutationFn: () => auth.login(email.trim(), password), onSuccess: onTokens, onError });

  const submitPhone = (e: FormEvent) => {
    e.preventDefault();
    if (challenge) otpVerify.mutate();
    else otpReq.mutate();
  };

  const pillars: { icon: LucideIcon; text: string }[] = [
    { icon: AudioLines, text: t('pillarVoice') },
    { icon: WifiOff, text: t('pillarOffline') },
    { icon: ShieldCheck, text: t('pillarHuman') },
  ];

  return (
    <div className="min-h-[calc(100dvh-28px)] lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* Brand panel */}
      <section className="relative overflow-hidden bg-brand text-brand-ink">
        <AjrakPattern className="text-white/[0.07]" />
        <div className="absolute -bottom-32 -end-24 h-80 w-80 rounded-full bg-accent/25 blur-3xl" aria-hidden />
        <div className="relative flex h-full flex-col gap-8 px-6 py-8 sm:px-10 lg:min-h-[calc(100dvh-28px)] lg:justify-between lg:py-12">
          <div className="flex items-center gap-3">
            <HaqdaarMark className="h-12 w-12 bg-white/15 shadow-none" />
            <div>
              <p className="text-xl font-bold leading-none">{lang === 'ur' ? 'حقدار' : 'Haqdaar'}</p>
              <p className="mt-1 text-sm text-white/75">{lang === 'ur' ? 'Haqdaar' : 'حقدار'}</p>
            </div>
          </div>
          <div className="max-w-xl">
            <h1 className="text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">{t('heroTitle')}</h1>
            <p className="mt-5 max-w-[46ch] text-lg leading-relaxed text-white/85">{t('heroBody')}</p>
            <ul className="mt-8 hidden gap-3 sm:grid">
              {pillars.map((p) => (
                <li key={p.text} className="flex items-center gap-3 text-base font-medium">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/12 ring-1 ring-white/20">
                    <p.icon className="h-5 w-5" aria-hidden />
                  </span>
                  {p.text}
                </li>
              ))}
            </ul>
          </div>
          <p className="hidden text-sm text-white/65 lg:block">{t('heroFoot')}</p>
        </div>
      </section>

      {/* Sign-in panel */}
      <section className="mx-auto w-full max-w-xl px-5 py-8 sm:px-8 lg:py-12">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold">{t('loginTitle')}</h2>
            <p className="mt-1 text-muted">{t('loginSubtitle')}</p>
          </div>
          <button
            type="button"
            onClick={() => langStore.set(lang === 'ur' ? 'en' : 'ur')}
            className="min-h-tap shrink-0 rounded-full border-2 border-line px-4 text-sm font-semibold hover:border-line-strong"
          >
            {t('switchLang')}
          </button>
        </div>

        <Link
          to="/scam-check"
          className="group mb-6 flex items-center gap-4 rounded-2xl border border-accent/30 bg-warn-soft p-4 transition-colors hover:border-accent"
        >
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-white">
            <MessageSquareWarning className="h-6 w-6" aria-hidden />
          </span>
          <span className="flex-1 font-semibold">{t('checkMessageNoLogin')}</span>
          <Chevron className="h-5 w-5 text-accent transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" aria-hidden />
        </Link>

        {error && (
          <p role="alert" className="mb-4 rounded-xl border border-danger/30 bg-danger-soft p-3 font-medium text-danger">
            {error}
          </p>
        )}

        <Tabs defaultValue="demo" onValueChange={() => setError(null)} dir={lang === 'ur' ? 'rtl' : 'ltr'}>
          <TabsList className="grid h-auto w-full grid-cols-3 rounded-xl p-1">
            <TabsTrigger value="demo" className="min-h-[40px] rounded-lg text-sm font-semibold">{t('tabDemo')}</TabsTrigger>
            <TabsTrigger value="phone" className="min-h-[40px] rounded-lg text-sm font-semibold">{t('tabPhone')}</TabsTrigger>
            <TabsTrigger value="staff" className="min-h-[40px] rounded-lg text-sm font-semibold">{t('tabStaff')}</TabsTrigger>
          </TabsList>

          <TabsContent value="demo" className="mt-5 space-y-6">
            <p className="flex items-center gap-2 text-sm text-muted">
              <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
              {t('demoLoginHint')}
            </p>
            <ul className="space-y-2.5">
              {CITIZEN_PERSONAS.map((p, i) => (
                <li key={p.key}>
                  <button
                    type="button"
                    onClick={() => { setError(null); demo.mutate(p.key); }}
                    disabled={demo.isPending}
                    aria-busy={demo.isPending && demo.variables === p.key}
                    className={cn(
                      'group flex w-full items-center gap-4 rounded-2xl border-2 bg-surface p-3.5 text-start transition-[border-color,transform] duration-fast hover:border-brand active:scale-[0.99] disabled:opacity-60',
                      i === 0 ? 'border-brand/40' : 'border-line',
                    )}
                  >
                    <span className={cn('inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', i === 0 ? 'bg-brand text-brand-ink' : 'bg-brand-soft text-brand')}>
                      <p.icon className="h-6 w-6" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-lg font-bold">{lang === 'ur' && p.nameUr ? p.nameUr : p.name}</span>
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted" lang="en">{p.role}</span>
                      </span>
                      <span className="block text-sm text-muted">{lang === 'ur' && p.storyUr ? p.storyUr : p.story}</span>
                    </span>
                    <Chevron className="h-5 w-5 shrink-0 text-muted group-hover:text-brand" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>

            <div dir="ltr" lang="en">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Department staff and auditor</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {STAFF_PERSONAS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => { setError(null); demo.mutate(p.key); }}
                    disabled={demo.isPending}
                    className="group flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-start font-sans transition-colors duration-fast hover:border-line-strong hover:bg-sunken disabled:opacity-60"
                  >
                    <p.icon className="h-5 w-5 shrink-0 text-muted group-hover:text-brand" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{p.name}</span>
                      <span className="block truncate text-xs text-muted">{p.role} · {p.story}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="phone" className="mt-5">
            <Card className="rounded-2xl border-line shadow-none">
              <CardContent className="p-5">
                <form onSubmit={submitPhone} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="phone" className="font-semibold">{t('phoneLabel')}</Label>
                    <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" dir="ltr" disabled={!!challenge} className="num h-14 rounded-xl text-xl" />
                  </div>
                  {challenge && (
                    <div className="space-y-1.5">
                      <Label htmlFor="otp" className="font-semibold">{t('codeLabel')}</Label>
                      <Input id="otp" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" dir="ltr" autoFocus className="num h-14 rounded-xl text-center text-2xl tracking-[0.5em]" />
                      <p className="text-sm text-muted">{t('smsHint')}</p>
                    </div>
                  )}
                  <Button type="submit" size="lg" block loading={otpReq.isPending || otpVerify.isPending} disabled={!!challenge && code.length !== 6}>
                    {challenge ? t('verifyCode') : t('sendCode')}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="staff" className="mt-5">
            <Card className="rounded-2xl border-line shadow-none">
              <CardContent className="p-5">
                <form onSubmit={(e) => { e.preventDefault(); staff.mutate(); }} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="font-semibold">Email</Label>
                    <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" dir="ltr" required className="h-12 rounded-xl" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password" className="font-semibold">Password</Label>
                    <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" dir="ltr" required className="h-12 rounded-xl" />
                  </div>
                  <Button type="submit" size="lg" block loading={staff.isPending}>
                    {lang === 'ur' ? 'لاگ ان' : 'Log in'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}

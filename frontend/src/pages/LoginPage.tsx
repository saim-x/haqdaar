import { useMutation } from '@tanstack/react-query';
import {
  AudioLines,
  BadgeCheck,
  Building2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  ArrowUpRight,
  Loader2,
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
import { ServiceGuide } from '../shared/ui/ServiceGuide';

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
    story: 'Widow in Thatta. Cannot read, weak signal.',
    storyUr: 'بیوہ، ٹھٹھہ۔ پڑھ نہیں سکتیں، کمزور سگنل۔',
    icon: UserRound,
  },
  {
    key: 'shopkeeper_rasool',
    name: 'Rasool Bakhsh',
    nameUr: 'رسول بخش',
    role: 'Citizen',
    story: 'Shopkeeper in Hyderabad. Gets fake relief SMS.',
    storyUr: 'دکاندار، حیدرآباد۔ جعلی امدادی پیغامات ملتے ہیں۔',
    icon: Store,
  },
  {
    key: 'helper_ayesha',
    name: 'Ayesha Khatoon',
    nameUr: 'عائشہ خاتون',
    role: 'Helper',
    story: 'Serves many families from one shared phone.',
    storyUr: 'ایک فون سے کئی خاندانوں کی مدد کرتی ہیں۔',
    icon: HandHeart,
  },
];

const STAFF_PERSONAS: Persona[] = [
  {
    key: 'officer_sana',
    name: 'Sana Qureshi',
    role: 'Officer · SPD',
    story: 'Priority queue, first approver',
    icon: BadgeCheck,
  },
  {
    key: 'officer_imran',
    name: 'Imran Siddiqui',
    role: 'Officer · SPD',
    story: 'Second approver (four-eyes)',
    icon: UserCheck,
  },
  {
    key: 'admin_bilal',
    name: 'Bilal Ahmed',
    role: 'Admin · SPD',
    story: 'Rules, Digital Twin, keys',
    icon: Settings2,
  },
  {
    key: 'admin_platform',
    name: 'Platform Admin',
    role: 'Admin · Platform',
    story: 'Chaos controls, demo reset',
    icon: Building2,
  },
  {
    key: 'auditor_nadia',
    name: 'Nadia Farooq',
    role: 'Auditor',
    story: 'Traces, consent, chain verify',
    icon: Eye,
  },
  {
    key: 'officer_zakat',
    name: 'Tariq Mehmood',
    role: 'Officer · ZWB',
    story: 'Other tenant, proves isolation',
    icon: Landmark,
  },
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
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Chevron = lang === 'ur' ? ChevronLeft : ChevronRight;

  const onTokens = async (tokens: TokenPayload) => {
    await completeLogin(tokens);
    nav(from && from !== '/login' ? from : homePathFor(tokens.user.role), { replace: true });
  };
  const onError = (e: unknown) =>
    setError(e instanceof ApiError ? pick(e.messageUr, e.message) : t('somethingWrong'));

  const demo = useMutation({ mutationFn: auth.demoLogin, onSuccess: onTokens, onError });
  const otpReq = useMutation({
    mutationFn: () => auth.otpRequest(phone.trim()),
    onSuccess: (r) => {
      setChallenge(r.challenge_id);
      setError(null);
    },
    onError,
  });
  const otpVerify = useMutation({
    mutationFn: () => auth.otpVerify(challenge!, code.trim()),
    onSuccess: onTokens,
    onError,
  });
  const staff = useMutation({
    mutationFn: () => auth.login(email.trim(), password),
    onSuccess: onTokens,
    onError,
  });

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
    <div className="min-h-[calc(100dvh-28px)] lg:grid lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)]">
      {/* Brand panel */}
      <section className="login-brand relative overflow-hidden bg-primary text-primary-foreground lg:sticky lg:top-[var(--prototype-height,28px)] lg:h-[calc(100dvh-var(--prototype-height,28px))]">
        <AjrakPattern className="!start-auto !w-1/3 text-white/[0.06]" />
        <div className="relative flex h-full flex-col gap-8 px-6 py-7 sm:px-10 lg:justify-between lg:px-14 lg:py-10">
          <div className="flex items-center gap-3">
            <HaqdaarMark className="h-12 w-12 bg-white/15 shadow-none" />
            <div>
              <p className="text-xl font-bold leading-none">{lang === 'ur' ? 'حقدار' : 'Haqdaar'}</p>
              <p className="mt-1 text-sm text-white/75">{lang === 'ur' ? 'Haqdaar' : 'حقدار'}</p>
            </div>
          </div>
          <div className="login-intro max-w-xl">
            <p className="mb-5 hidden text-xs font-semibold uppercase tracking-[0.2em] text-white/65 lg:block">
              {pick('آسان راستہ، محفوظ مستقبل', 'A simpler way forward')}
            </p>
            <h1 className="max-w-[12ch] text-4xl font-bold leading-[1.12] tracking-tight sm:text-5xl lg:text-[clamp(40px,4.3vw,68px)]">
              {t('heroTitle')}
            </h1>
            <p className="login-body mt-5 max-w-[38ch] text-base leading-relaxed text-white/80">
              {t('heroBody')}
            </p>
            <div className="relative my-8 hidden rounded-2xl border border-white/20 bg-white/[0.06] p-5 lg:block">
              <span className="mb-4 block text-xs font-medium text-white/70">
                {pick('ایک وقت میں ایک قدم', 'One step at a time')}
              </span>
              <div className="flex items-center gap-3" aria-hidden>
                {[UserRound, AudioLines, ShieldCheck].map((Icon, i) => (
                  <div key={i} className="flex flex-1 items-center gap-3">
                    <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10">
                      <Icon className="h-5 w-5" />
                    </span>
                    {i < 2 && <span className="h-px flex-1 bg-white/25" />}
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-between gap-2 text-xs text-white/90">
                <span>{pick('اپنا تعارف', 'Tell your story')}</span>
                <span>{pick('رہنمائی سے درخواست', 'Apply with guidance')}</span>
                <span>{pick('خبر رکھیں', 'Stay informed')}</span>
              </div>
            </div>
            <ul className="login-pillars mt-6 hidden gap-3 sm:grid">
              {pillars.map((p) => (
                <li key={p.text} className="flex items-center gap-3 text-base font-medium">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10">
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
      <section className="login-panel mx-auto w-full max-w-[640px] px-5 py-6 sm:px-10 lg:py-10">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <p className="eyebrow mb-2 hidden sm:block">
              {pick('یہاں سے شروع کریں', 'Welcome to your next step')}
            </p>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {pick('حقدار میں خوش آمدید', 'Welcome to Haqdaar')}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
              {pick('اپنی زبان میں، ایک آسان شروعات', 'A simple start, in your own language.')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => langStore.set(lang === 'ur' ? 'en' : 'ur')}
            className="min-h-tap shrink-0 rounded-full border border-border bg-card px-3 text-xs font-semibold hover:border-primary sm:px-4 sm:text-sm"
          >
            {t('switchLang')}
          </button>
        </div>

        {error && (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-danger/30 bg-danger-soft p-3 font-medium text-danger"
          >
            {error}
          </p>
        )}

        <Tabs defaultValue="demo" onValueChange={() => setError(null)} dir={lang === 'ur' ? 'rtl' : 'ltr'}>
          <TabsList className="grid h-auto w-full grid-cols-3 rounded-xl p-1">
            <TabsTrigger value="demo" className="min-h-12 rounded-lg text-sm font-semibold">
              {t('tabDemo')}
            </TabsTrigger>
            <TabsTrigger value="phone" className="min-h-12 rounded-lg text-sm font-semibold">
              {t('tabPhone')}
            </TabsTrigger>
            <TabsTrigger value="staff" className="min-h-12 rounded-lg text-sm font-semibold">
              {t('tabStaff')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="demo" className="mt-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">
                {pick('ایک ڈیمو پروفائل منتخب کریں', 'Choose a demo profile')}
              </h3>
              <span className="shrink-0 rounded-full bg-primary-soft px-2 py-1 text-[10px] font-semibold text-primary">
                {pick('فرضی ڈیٹا', 'Synthetic data')}
              </span>
            </div>
            <ul className="space-y-2.5">
              {CITIZEN_PERSONAS.map((p, i) => (
                <li key={p.key}>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      demo.mutate(p.key);
                    }}
                    disabled={demo.isPending}
                    aria-busy={demo.isPending && demo.variables === p.key}
                    className={cn(
                      'surface-interactive group flex w-full items-center gap-3 rounded-2xl border bg-card p-3.5 text-start active:scale-[0.99] disabled:opacity-60 sm:gap-4 sm:p-4',
                      i === 0 ? 'border-primary/40' : 'border-border',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl',
                        i === 0 ? 'bg-primary text-primary-foreground' : 'bg-primary-soft text-primary',
                      )}
                    >
                      <p.icon className="h-6 w-6" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-base font-bold">
                          {lang === 'ur' && p.nameUr ? p.nameUr : p.name}
                        </span>
                        <span className="text-[10px] font-semibold text-muted-foreground">
                          {pick(p.role === 'Helper' ? 'ہیلپر' : 'شہری', p.role)}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                        {lang === 'ur' && p.storyUr ? p.storyUr : p.story}
                      </span>
                    </span>
                    {demo.isPending && demo.variables === p.key ? (
                      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                    ) : (
                      <Chevron
                        className="h-5 w-5 shrink-0 text-muted-foreground group-hover:text-primary"
                        aria-hidden
                      />
                    )}
                  </button>
                </li>
              ))}
            </ul>

            <details className="group rounded-2xl border border-border bg-card">
              <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                <Building2 className="h-5 w-5 text-primary" aria-hidden />
                <span className="flex-1">{pick('عملہ اور آڈیٹر پروفائل', 'Staff & auditor profiles')}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">6</span>
                <Chevron
                  className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90"
                  aria-hidden
                />
              </summary>
              <div dir="ltr" lang="en" className="grid gap-2 border-t border-border p-3 sm:grid-cols-2">
                {STAFF_PERSONAS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => {
                      setError(null);
                      demo.mutate(p.key);
                    }}
                    disabled={demo.isPending}
                    className="group flex min-h-[72px] items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 text-start font-sans transition-colors duration-fast hover:border-primary/40 hover:bg-primary-soft/50 disabled:opacity-60"
                  >
                    <p.icon
                      className="h-5 w-5 shrink-0 text-muted-foreground group-hover:text-primary"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{p.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {p.role} · {p.story}
                      </span>
                    </span>
                    {demo.isPending && demo.variables === p.key && (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    )}
                  </button>
                ))}
              </div>
            </details>
            <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {t('demoLoginHint')}
            </p>
          </TabsContent>

          <TabsContent value="phone" className="mt-5">
            <Card className="rounded-2xl border-border shadow-none">
              <CardContent className="p-5">
                <form onSubmit={submitPhone} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="phone" className="font-semibold">
                      {t('phoneLabel')}
                    </Label>
                    <Input
                      id="phone"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      inputMode="tel"
                      autoComplete="tel"
                      dir="ltr"
                      disabled={!!challenge}
                      className="num h-14 rounded-xl text-xl"
                    />
                  </div>
                  {challenge && (
                    <div className="space-y-1.5">
                      <Label htmlFor="otp" className="font-semibold">
                        {t('codeLabel')}
                      </Label>
                      <Input
                        id="otp"
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        dir="ltr"
                        autoFocus
                        className="num h-14 rounded-xl text-center text-2xl tracking-[0.5em]"
                      />
                      <p className="text-sm text-muted-foreground">{t('smsHint')}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setChallenge(null);
                          setCode('');
                          setError(null);
                        }}
                        className="min-h-12 text-sm font-semibold text-primary"
                      >
                        {pick('فون نمبر تبدیل کریں', 'Use a different phone number')}
                      </button>
                    </div>
                  )}
                  <Button
                    type="submit"
                    size="lg"
                    block
                    loading={otpReq.isPending || otpVerify.isPending}
                    disabled={otpReq.isPending || otpVerify.isPending || (!!challenge && code.length !== 6)}
                  >
                    {challenge ? t('verifyCode') : t('sendCode')}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="staff" className="mt-5">
            <Card className="rounded-2xl border-border shadow-none">
              <CardContent className="p-5">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    staff.mutate();
                  }}
                  className="space-y-4"
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="font-semibold">
                      Email
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="username"
                      dir="ltr"
                      required
                      className="h-12 rounded-xl"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password" className="font-semibold">
                      Password
                    </Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                        dir="ltr"
                        required
                        className="h-12 rounded-xl pe-14"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={pick(
                          showPassword ? 'پاس ورڈ چھپائیں' : 'پاس ورڈ دکھائیں',
                          showPassword ? 'Hide password' : 'Show password',
                        )}
                        aria-pressed={showPassword}
                        className="absolute end-0 top-0 flex h-12 w-12 items-center justify-center text-muted-foreground"
                      >
                        {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    </div>
                  </div>
                  <Button type="submit" size="lg" block loading={staff.isPending} disabled={staff.isPending}>
                    {lang === 'ur' ? 'لاگ ان' : 'Log in'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        <Link
          to="/scam-check"
          className="mt-6 flex min-h-16 items-center gap-3 rounded-2xl border border-primary/15 bg-primary-soft px-4 py-3 text-sm font-semibold text-primary"
        >
          <MessageSquareWarning className="h-5 w-5 shrink-0" aria-hidden />
          <span className="flex-1">{t('checkMessageNoLogin')}</span>
          <Chevron className="h-4 w-4 shrink-0" aria-hidden />
        </Link>
        <details className="mt-5">
          <summary className="flex min-h-12 cursor-pointer items-center justify-center text-xs font-semibold text-muted-foreground">
            {pick('شروع کرنے سے پہلے مدد', 'Need a little guidance?')}
          </summary>
          <ServiceGuide />
        </details>
        <Link
          to="/transparency"
          className="mt-4 flex min-h-12 items-center justify-center gap-2 text-xs text-muted-foreground hover:text-primary"
        >
          {pick('کیا اصلی ہے، کیا نقلی ہے؟', 'What’s real and what’s simulated?')}
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </section>
    </div>
  );
}

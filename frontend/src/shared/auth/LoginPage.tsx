import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { PERSONAS, type PersonaKey } from './personas';
import { roleHome } from './roleHome';
import { useDemoMode } from './useDemoMode';
import { useI18n } from '../i18n/I18nProvider';
import { errorMessage } from '../api/errors';
import type { Role } from '../api/types';
import { TapButton } from '../ui/TapButton';
import { IconArrowRight, IconGlobe, IconPhone, IconShield } from '../ui/Icons';
import { AudioButton } from '../ui/AudioButton';
import { BrandLockup } from '../ui/Brand';

type Tab = 'citizen' | 'staff';

/** Role word for the demo ledger - the same five labels the rest of the app uses. */
const ROLE_LABEL = {
  CITIZEN: 'login.roleCitizen',
  HELPER: 'login.roleHelper',
  OFFICER: 'login.roleOfficer',
  ADMIN: 'login.roleAdmin',
  AUDITOR: 'login.roleAuditor',
} as const satisfies Record<Role, string>;

/**
 * Sign-in - docs/02 F-01.
 *  - citizens: phone + 6-digit OTP (simulated SMS)
 *  - staff/helpers: email + password
 *  - judges: one-tap demo persona login, clearly labelled as a prototype affordance
 *
 * The page has one job: get you in. So it is a wordmark, a two-way switch, one
 * card of fields, and the demo list beside it as a plain ledger of people. No
 * hero, no illustration, no gradient - a government counter does not sell itself.
 *
 * On a wide screen the two halves sit side by side, so the whole page fits one
 * viewport instead of scrolling past a long strip of empty paper.
 */
export function LoginPage() {
  const { t, lang, toggleLang } = useI18n();
  const navigate = useNavigate();
  const { demoLogin, loginWithPassword, requestOtp, verifyOtp } = useAuth();
  const { data: demoMode } = useDemoMode();

  const [tab, setTab] = useState<Tab>('citizen');
  const [phone, setPhone] = useState('+923001000001');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [email, setEmail] = useState('sana@spd.mock');
  const [password, setPassword] = useState('Demo@2026');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleDemo(key: PersonaKey) {
    setBusy(key);
    setError(null);
    try {
      const session = await demoLogin(key);
      navigate(roleHome(session.user), { replace: true });
    } catch (err) {
      setError(errorMessage(err, lang));
    } finally {
      setBusy(null);
    }
  }

  async function handleSendOtp() {
    setBusy('otp');
    setError(null);
    try {
      const res = await requestOtp(phone);
      setChallengeId(res.challenge_id);
      setNotice(t('login.otpSent'));
    } catch (err) {
      setError(errorMessage(err, lang));
    } finally {
      setBusy(null);
    }
  }

  async function handleVerifyOtp() {
    if (!challengeId) return;
    setBusy('verify');
    setError(null);
    try {
      const session = await verifyOtp(challengeId, otp);
      navigate(roleHome(session.user), { replace: true });
    } catch (err) {
      setError(errorMessage(err, lang));
    } finally {
      setBusy(null);
    }
  }

  async function handlePassword() {
    setBusy('password');
    setError(null);
    try {
      const session = await loginWithPassword(email, password);
      navigate(roleHome(session.user), { replace: true });
    } catch (err) {
      setError(errorMessage(err, lang));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[560px] px-5 pb-16 pt-5 lg:flex lg:min-h-[calc(100vh-28px)] lg:max-w-[940px] lg:items-center">
      <div className={demoMode ? 'w-full lg:grid lg:grid-cols-2 lg:items-start lg:gap-16' : 'mx-auto w-full max-w-[480px]'}>
        <div>
          <header className="enter enter-1 mb-7 mt-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1>
                <BrandLockup height={44} alt={t('app.name')} />
              </h1>
              <p className="mt-2 text-body leading-[1.7] text-ink-2">{t('app.tagline')}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={toggleLang}
                data-testid="lang-toggle"
                className="press inline-flex min-h-tap items-center gap-1 rounded-control px-2 text-meta font-medium text-ink-2 hover:text-ink"
                aria-label={t('common.switchLanguage')}
              >
                <IconGlobe size={14} />
                {lang === 'ur' ? 'سنڌي' : lang === 'sd' ? 'EN' : 'اردو'}
              </button>
              <AudioButton audioKey="login_welcome" text={t('login.subtitle')} />
            </div>
          </header>

          <div
            className="enter enter-2 mb-5 grid grid-cols-2 gap-1 rounded-control bg-raised p-1"
            role="tablist"
          >
            {(['citizen', 'staff'] as Tab[]).map((key) => {
              const selected = tab === key;
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setTab(key)}
                  className={`press min-h-tap rounded-[8px] text-body ${
                    selected
                      ? 'bg-card font-medium text-ink shadow-hair'
                      : 'text-ink-2 hover:text-ink'
                  }`}
                >
                  {key === 'citizen' ? t('login.roleCitizen') : t('login.staffTitle')}
                </button>
              );
            })}
          </div>

          {error && (
            <div
              role="alert"
              className="enter mb-4 rounded-control border border-negative/25 bg-negative-wash px-4 py-3 text-caption font-medium text-negative"
            >
              {error}
            </div>
          )}
          {notice && (
            <div
              role="status"
              className="enter mb-4 rounded-control border border-accent/25 bg-accent-wash px-4 py-3 text-caption font-medium text-accent-ink"
            >
              {notice}
            </div>
          )}

          {tab === 'citizen' ? (
            <section className="card enter enter-3 p-5">
              <label htmlFor="phone" className="block text-caption font-medium text-ink-2">
                {t('login.phone')}
              </label>
              <input
                id="phone"
                type="tel"
                inputMode="tel"
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="num mt-1.5 font-mono"
                autoComplete="tel"
              />
              {!challengeId ? (
                <TapButton
                  block
                  className="mt-4"
                  onClick={handleSendOtp}
                  disabled={busy === 'otp'}
                  icon={<IconPhone size={20} />}
                >
                  {t('login.sendOtp')}
                </TapButton>
              ) : (
                <>
                  <label htmlFor="otp" className="mt-5 block text-caption font-medium text-ink-2">
                    {t('login.otp')}
                  </label>
                  <input
                    id="otp"
                    type="text"
                    inputMode="numeric"
                    dir="ltr"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    className="num mt-1.5 text-center font-mono text-title-lg tracking-[0.2em]"
                    autoComplete="one-time-code"
                  />
                  <TapButton
                    block
                    className="mt-4"
                    onClick={handleVerifyOtp}
                    disabled={otp.length !== 6 || busy === 'verify'}
                  >
                    {t('login.verify')}
                  </TapButton>
                </>
              )}
            </section>
          ) : (
            <section className="card enter enter-3 p-5">
              <label htmlFor="email" className="block text-caption font-medium text-ink-2">
                {t('login.email')}
              </label>
              <input
                id="email"
                type="email"
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5"
                autoComplete="username"
              />
              <label htmlFor="password" className="mt-5 block text-caption font-medium text-ink-2">
                {t('login.password')}
              </label>
              <input
                id="password"
                type="password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5"
                autoComplete="current-password"
              />
              <TapButton
                block
                className="mt-4"
                onClick={handlePassword}
                disabled={busy === 'password'}
                icon={<IconShield size={20} />}
              >
                {t('login.signIn')}
              </TapButton>
            </section>
          )}
        </div>

        {demoMode && <section className="enter enter-4 mt-9 lg:mt-4">
          <h2 className="section-label">{t('login.demoTitle')}</h2>
          <p className="mt-2 text-meta leading-[1.7] text-ink-3">{t('login.demoHint')}</p>

          <ul className="card mt-3 overflow-hidden">
            {PERSONAS.map((persona) => (
              <li key={persona.key} className="border-b border-ink/[0.08] last:border-b-0">
                <button
                  type="button"
                  data-persona={persona.key}
                  onClick={() => void handleDemo(persona.key)}
                  disabled={busy !== null}
                  className="press flex min-h-primary w-full items-center gap-3 px-4 py-2.5 text-start hover:bg-raised disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 truncate text-body font-medium text-ink">
                        {lang === 'ur' ? persona.nameUr : persona.name}
                      </span>
                      <span className="shrink-0 text-meta text-ink-3">
                        {t(ROLE_LABEL[persona.role])}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-meta text-ink-3">
                      {lang === 'ur' ? persona.blurbUr : persona.blurbEn}
                    </span>
                  </span>
                  <IconArrowRight size={16} className="shrink-0 text-ink-3" />
                </button>
              </li>
            ))}
          </ul>
        </section>}
      </div>
    </div>
  );
}

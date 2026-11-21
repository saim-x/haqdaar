import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { PERSONAS, type PersonaKey } from './personas';
import { roleHome } from './roleHome';
import { useI18n } from '../i18n/I18nProvider';
import { errorMessage } from '../api/errors';
import { TapButton } from '../ui/TapButton';
import { IconArrowRight, IconPhone, IconShield } from '../ui/Icons';
import { AudioButton } from '../ui/AudioButton';

type Tab = 'citizen' | 'staff';

/**
 * Sign-in — docs/02 F-01.
 *  - citizens: phone + 6-digit OTP (simulated SMS)
 *  - staff/helpers: email + password
 *  - judges: one-tap demo persona login, clearly labelled as a prototype affordance
 *
 * The page has one job: get you in. So it is a wordmark, a two-way switch, one
 * card of fields, and the demo list underneath as a plain ledger of people. No
 * hero, no illustration, no gradient — a government counter does not sell itself.
 */
export function LoginPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { demoLogin, loginWithPassword, requestOtp, verifyOtp } = useAuth();

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
      const persona = PERSONAS.find((p) => p.key === key);
      navigate(persona?.home ?? roleHome(session.user.role), { replace: true });
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
      navigate(roleHome(session.user.role), { replace: true });
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
      navigate(roleHome(session.user.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err, lang));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="screen">
      <header className="enter enter-1 mb-7 mt-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-display-lg font-medium leading-[1.2] text-ink">{t('app.name')}</h1>
          <p className="mt-1 text-body leading-[1.7] text-ink-2">{t('app.tagline')}</p>
        </div>
        <AudioButton audioKey="login_welcome" text={t('login.subtitle')} />
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

      <section className="enter enter-4 mt-8">
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
                className="press flex min-h-primary w-full items-center gap-3 px-4 py-3 text-start hover:bg-raised disabled:opacity-50"
              >
                <span
                  aria-hidden
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-caption font-medium text-white"
                  style={{ backgroundColor: persona.accent }}
                >
                  {persona.name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-ink">
                    {lang === 'ur' ? persona.nameUr : persona.name}
                  </span>
                  <span className="block truncate text-meta text-ink-3">
                    {lang === 'ur' ? persona.blurbUr : persona.blurbEn}
                  </span>
                </span>
                <span className="shrink-0 text-meta text-ink-3">{persona.role}</span>
                <IconArrowRight size={16} className="shrink-0 text-ink-3" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

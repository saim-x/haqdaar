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
      <header className="mb-6 mt-2 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-teal-700">{t('app.name')}</h1>
          <p className="text-sm text-ink-soft">{t('app.tagline')}</p>
        </div>
        <AudioButton audioKey="login_welcome" text={t('login.subtitle')} />
      </header>

      <div className="mb-5 grid grid-cols-2 gap-2" role="tablist">
        {(['citizen', 'staff'] as Tab[]).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`min-h-primary rounded-2xl border-2 text-base font-semibold ${
              tab === key ? 'border-teal-700 bg-teal-600 text-white' : 'border-ink/20 bg-white text-ink'
            }`}
          >
            {key === 'citizen' ? t('login.roleCitizen') : t('login.staffTitle')}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-2xl border-2 border-[#B42318]/40 bg-[#B42318]/10 px-4 py-3 text-sm font-semibold text-[#B42318]">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="mb-4 rounded-2xl border-2 border-teal-600/30 bg-teal-50 px-4 py-3 text-sm font-semibold text-teal-800">
          {notice}
        </div>
      )}

      {tab === 'citizen' ? (
        <section className="card p-4">
          <label htmlFor="phone" className="mb-1 block text-sm font-semibold text-ink-soft">
            {t('login.phone')}
          </label>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            dir="ltr"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="num"
            autoComplete="tel"
          />
          {!challengeId ? (
            <TapButton block className="mt-3" onClick={handleSendOtp} disabled={busy === 'otp'} icon={<IconPhone size={20} />}>
              {t('login.sendOtp')}
            </TapButton>
          ) : (
            <>
              <label htmlFor="otp" className="mb-1 mt-4 block text-sm font-semibold text-ink-soft">
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
                className="num tracking-[0.4em]"
                autoComplete="one-time-code"
              />
              <TapButton block className="mt-3" onClick={handleVerifyOtp} disabled={otp.length !== 6 || busy === 'verify'}>
                {t('login.verify')}
              </TapButton>
            </>
          )}
        </section>
      ) : (
        <section className="card p-4">
          <label htmlFor="email" className="mb-1 block text-sm font-semibold text-ink-soft">
            {t('login.email')}
          </label>
          <input id="email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          <label htmlFor="password" className="mb-1 mt-4 block text-sm font-semibold text-ink-soft">
            {t('login.password')}
          </label>
          <input
            id="password"
            type="password"
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          <TapButton block className="mt-3" onClick={handlePassword} disabled={busy === 'password'} icon={<IconShield size={20} />}>
            {t('login.signIn')}
          </TapButton>
        </section>
      )}

      <section className="mt-8">
        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">{t('login.demoTitle')}</h2>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">DEMO_MODE</span>
        </div>
        <p className="mb-3 text-xs text-ink-soft">{t('login.demoHint')}</p>
        <ul className="grid gap-2">
          {PERSONAS.map((persona) => (
            <li key={persona.key}>
              <button
                type="button"
                onClick={() => void handleDemo(persona.key)}
                disabled={busy !== null}
                className="flex min-h-primary w-full items-center gap-3 rounded-2xl border-2 border-ink/15 bg-white px-3 py-2 text-start transition hover:border-teal-600 hover:bg-teal-50 disabled:opacity-60"
              >
                <span
                  aria-hidden
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
                  style={{ backgroundColor: persona.accent }}
                >
                  {persona.name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-ink">
                    {lang === 'ur' ? persona.nameUr : persona.name}
                  </span>
                  <span className="block truncate text-xs text-ink-soft">
                    {lang === 'ur' ? persona.blurbUr : persona.blurbEn}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-bold uppercase text-ink-soft">
                  {persona.role}
                </span>
                <IconArrowRight size={16} className="shrink-0 text-ink-soft rtl:rotate-180" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

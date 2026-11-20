import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../shared/api/client';
import { errorMessage } from '../shared/api/errors';
import type { HelperFamily } from '../shared/api/types';
import { useAudio } from '../shared/audio/AudioProvider';
import { useVoiceCapture } from '../shared/audio/useVoiceCapture';
import { useAuth } from '../shared/auth/AuthProvider';
import { useI18n } from '../shared/i18n/I18nProvider';
import { wipeCitizenLocalData } from '../shared/offline/db';
import { AudioButton } from '../shared/ui/AudioButton';
import { TapButton } from '../shared/ui/TapButton';
import { IconCheck, IconMic, IconPlus, IconSearch, IconShield, IconUsers, IconWarning } from '../shared/ui/Icons';
import { SINDH_DISTRICTS, districtLabel } from '../shared/lib/districts';
import { digitsOnly, formatCnic, isCompleteCnic, isCompletePhone, toE164Pk } from '../shared/lib/cnic';
import { DigitPad } from '../citizen/wizard/inputs';

interface FamiliesResponse {
  items: HelperFamily[];
}

/**
 * Helper Mode — docs/11 §4, F-13.
 *
 * Ayesha serves 40 families from one shared phone. The safety property that
 * matters is that switching families leaves *nothing* of the previous family
 * behind: query cache cleared synchronously, wizard state wiped, IndexedDB
 * drafts for the old citizen deleted, and a full-screen confirmation before any
 * citizen screen can render.
 */
export function HelperRosterPage() {
  const { t, lang } = useI18n();
  const { actFor, setActFor } = useAuth();
  const { play } = useAudio();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<HelperFamily | null>(null);
  const [switching, setSwitching] = useState(false);

  const families = useQuery({
    queryKey: ['helper', 'families'],
    queryFn: () => api.get<FamiliesResponse>('/helper/families'),
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    const list = families.data?.items ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((family) => family.full_name.toLowerCase().includes(needle));
  }, [families.data, search]);

  const switchTo = useCallback(
    async (family: HelperFamily) => {
      setSwitching(true);
      const previous = actFor?.citizenId ?? null;
      // Order matters: drop the old family's cached data before the new identity
      // is visible to any component.
      queryClient.clear();
      if (previous && previous !== family.citizen_id) {
        await wipeCitizenLocalData(previous);
      }
      setActFor({
        citizenId: family.citizen_id,
        fullName: family.full_name,
        avatarColor: family.avatar_color,
        district: family.district,
      });
      setPending(family);
      setSwitching(false);
      void play('helper_switch', lang === 'ur' ? 'آپ اب اس گھرانے کی مدد کر رہی ہیں' : 'You are now helping this family');
    },
    [actFor?.citizenId, lang, play, queryClient, setActFor],
  );

  return (
    <div className="screen">
      <header className="mb-3 mt-1 flex items-start justify-between gap-3">
        <div>
          <h1 className="screen-title">{t('helper.title')}</h1>
          <p className="screen-hint">
            {lang === 'ur' ? 'ایک فون، کئی گھرانے۔ ہر گھرانہ الگ رکھا جاتا ہے۔' : 'One phone, many families. Each family stays separate.'}
          </p>
        </div>
        <AudioButton audioKey="helper_intro" text={t('helper.title')} />
      </header>

      <div className="mb-3 flex items-center gap-2 rounded-2xl border-2 border-ink/15 bg-white px-3">
        <IconSearch size={18} className="shrink-0 text-ink-soft" />
        <label htmlFor="family-search" className="sr-only">
          {t('helper.search')}
        </label>
        <input
          id="family-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('helper.search')}
          className="min-h-tap flex-1 border-0 bg-transparent px-0 text-base focus:ring-0"
        />
      </div>

      {families.isLoading && <p className="text-sm text-ink-soft">{t('common.loading')}</p>}

      {families.isError && (
        <div className="card p-4">
          <p className="text-sm text-ink-soft">{errorMessage(families.error, lang)}</p>
          <TapButton size="tap" variant="secondary" className="mt-3" onClick={() => void families.refetch()}>
            {t('common.tryAgain')}
          </TapButton>
        </div>
      )}

      <ul className="space-y-2">
        {filtered.map((family) => {
          const active = actFor?.citizenId === family.citizen_id;
          const locked = family.consent_status !== 'ACTIVE';
          return (
            <li key={family.citizen_id}>
              <button
                type="button"
                disabled={switching}
                onClick={() => void switchTo(family)}
                className={`card flex w-full items-center gap-3 p-3 text-start ${
                  active ? 'ring-2 ring-teal-600' : ''
                } ${locked ? 'opacity-70' : ''}`}
              >
                <span
                  aria-hidden
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-lg font-bold text-white"
                  style={{ backgroundColor: family.avatar_color }}
                >
                  {family.full_name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-bold text-ink">{family.full_name}</span>
                  <span className="num block text-[11px] text-ink-soft" dir="ltr">
                    {family.cnic_masked ?? '—'}
                    {family.district ? ` · ${districtLabel(family.district, lang)}` : ''}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        locked ? 'bg-[#B42318]/10 text-[#B42318]' : 'bg-[#0F7B3F]/10 text-[#0F7B3F]'
                      }`}
                    >
                      {locked ? t('helper.consentExpired') : t('helper.consentActive')}
                    </span>
                    {family.active_case_count > 0 && (
                      <span className="rounded-full bg-[#1D4ED8]/10 px-2 py-0.5 text-[10px] font-bold text-[#1D4ED8]">
                        {family.active_case_count} {t('helper.activeCases')}
                      </span>
                    )}
                  </span>
                </span>
                <AudioButton audioKey={null} text={family.full_name} label={`${t('common.listen')}: ${family.full_name}`} />
              </button>
            </li>
          );
        })}
      </ul>

      {!families.isLoading && filtered.length === 0 && (
        <div className="card mt-3 p-5 text-center">
          <IconUsers size={32} className="mx-auto text-ink-soft" />
          <p className="mt-2 text-sm text-ink-soft">
            {lang === 'ur' ? 'ابھی کوئی گھرانہ شامل نہیں۔' : 'No families yet.'}
          </p>
        </div>
      )}

      <Link
        to="/h/new"
        className="mt-4 flex min-h-primary w-full items-center justify-center gap-2 rounded-2xl border-2 border-teal-700 bg-teal-600 text-base font-bold text-white"
      >
        <IconPlus size={22} />
        {t('helper.addFamily')}
      </Link>

      {pending && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white px-6 text-center">
          <span
            aria-hidden
            className="grid h-28 w-28 place-items-center rounded-full text-4xl font-bold text-white"
            style={{ backgroundColor: pending.avatar_color }}
          >
            {pending.full_name.slice(0, 1)}
          </span>
          <p className="mt-5 text-sm font-semibold text-ink-soft">{t('helper.switchTitle')}</p>
          <h2 className="mt-1 text-2xl font-bold text-ink">{pending.full_name}</h2>
          <AudioButton
            className="mt-3"
            audioKey="helper_switch"
            text={`${t('helper.switchTitle')} ${pending.full_name}`}
            size="lg"
          />
          <TapButton
            block
            className="mt-8 max-w-[420px]"
            icon={<IconCheck size={22} />}
            onClick={() => {
              setPending(null);
              navigate('/c');
            }}
          >
            {t('helper.switchContinue')}
          </TapButton>
          <button
            type="button"
            onClick={() => setPending(null)}
            className="mt-3 min-h-tap text-sm font-semibold text-ink-soft underline"
          >
            {t('common.cancel')}
          </button>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- add family */

type ConsentMode = 'OTP' | 'VERBAL_WITNESSED';

export function AddFamilyPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const capture = useVoiceCapture(12);

  const [fullName, setFullName] = useState('');
  const [phoneDigits, setPhoneDigits] = useState('');
  const [cnicDigits, setCnicDigits] = useState('');
  const [district, setDistrict] = useState<string | null>(null);
  const [mode, setMode] = useState<ConsentMode>('OTP');
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ citizenId: string; challengeId: string | null } | null>(null);
  const [otp, setOtp] = useState('');
  const [done, setDone] = useState(false);

  const canSubmit =
    fullName.trim().length >= 3 &&
    isCompletePhone(phoneDigits) &&
    (mode === 'OTP' || (attested && capture.blob !== null));

  async function createFamily() {
    setBusy(true);
    setError(null);
    try {
      const payload = new FormData();
      payload.append('full_name', fullName.trim());
      payload.append('phone', toE164Pk(phoneDigits));
      if (district) payload.append('district', district);
      if (isCompleteCnic(cnicDigits)) payload.append('cnic_digits', digitsOnly(cnicDigits));
      payload.append('consent_mode', mode);
      if (mode === 'VERBAL_WITNESSED' && capture.blob) {
        payload.append('verbal_audio', capture.blob, 'consent.webm');
        payload.append('attested', 'true');
      }
      const res = await api.upload<{ citizen_id: string; challenge_id?: string | null }>('/helper/families', payload);
      setCreated({ citizenId: res.citizen_id, challengeId: res.challenge_id ?? null });
      void queryClient.invalidateQueries({ queryKey: ['helper', 'families'] });
      if (mode === 'VERBAL_WITNESSED') setDone(true);
    } catch (err) {
      setError(errorMessage(err, lang));
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    if (!created) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/helper/families/${created.citizenId}/consent-verify`, { code: otp });
      void queryClient.invalidateQueries({ queryKey: ['helper', 'families'] });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err, lang));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="screen">
        <div className="card mt-6 p-6 text-center">
          <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-[#0F7B3F] text-white">
            <IconCheck size={44} />
          </span>
          <h1 className="mt-4 text-xl font-bold text-ink">{fullName}</h1>
          <p className="mt-2 text-sm text-ink-soft">
            {mode === 'VERBAL_WITNESSED'
              ? t('helper.consentVerbalWarning')
              : lang === 'ur'
                ? 'اجازت مل گئی۔ اب آپ اس گھرانے کی مدد کر سکتی ہیں۔'
                : 'Consent granted. You can help this family now.'}
          </p>
          <TapButton block className="mt-5" onClick={() => navigate('/h', { replace: true })}>
            {t('helper.title')}
          </TapButton>
        </div>
      </div>
    );
  }

  return (
    <div className="screen pb-8">
      <header className="mb-3 mt-1 flex items-start justify-between gap-3">
        <h1 className="screen-title">{t('helper.addFamily')}</h1>
        <AudioButton audioKey="helper_add_family" text={t('helper.addFamily')} />
      </header>

      {error && (
        <div role="alert" className="mb-3 rounded-2xl border-2 border-[#B42318]/40 bg-[#B42318]/10 px-4 py-3 text-sm font-semibold text-[#B42318]">
          {error}
        </div>
      )}

      <section className="card p-4">
        <label htmlFor="family-name" className="block text-sm font-semibold text-ink">
          {t('wizard.name.title')}
        </label>
        <input
          id="family-name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="mt-1 text-base"
          placeholder={lang === 'ur' ? 'پورا نام' : 'Full name'}
        />

        <p className="mt-3 text-sm font-semibold text-ink">{t('wizard.payout.title')}</p>
        <DigitPad
          value={digitsOnly(phoneDigits)}
          onChange={setPhoneDigits}
          maxDigits={11}
          format={(digits) => (digits ? digits.replace(/(\d{4})(\d{0,7})/, '$1 $2').trim() : '')}
          audioKey="wizard_payout_phone"
          audioText={t('wizard.payout.title')}
        />

        <p className="mt-3 text-sm font-semibold text-ink">{t('wizard.cnic.title')}</p>
        <DigitPad
          value={digitsOnly(cnicDigits)}
          onChange={setCnicDigits}
          maxDigits={13}
          format={formatCnic}
          onUnknown={() => setCnicDigits('')}
          audioKey="wizard_applicant_cnic"
          audioText={t('wizard.cnic.title')}
        />

        <p className="mt-3 text-sm font-semibold text-ink">{t('wizard.district.title')}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {SINDH_DISTRICTS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setDistrict(item)}
              aria-pressed={district === item}
              className={`min-h-tap rounded-full border-2 px-3 text-xs font-bold ${
                district === item ? 'border-teal-700 bg-teal-600 text-white' : 'border-ink/15 bg-white text-ink'
              }`}
            >
              {districtLabel(item, lang)}
            </button>
          ))}
        </div>
      </section>

      <section className="card mt-3 p-4">
        <h2 className="text-sm font-bold text-ink">{t('helper.consentCapture')}</h2>

        <div className="mt-2 space-y-2">
          <button
            type="button"
            onClick={() => setMode('OTP')}
            aria-pressed={mode === 'OTP'}
            className={`flex min-h-primary w-full items-center gap-2 rounded-2xl border-2 px-3 text-start text-sm font-bold ${
              mode === 'OTP' ? 'border-teal-700 bg-teal-50 text-teal-800' : 'border-ink/15 bg-white text-ink'
            }`}
          >
            <IconShield size={20} className="shrink-0" />
            {t('helper.consentOtp')}
          </button>

          <button
            type="button"
            onClick={() => setMode('VERBAL_WITNESSED')}
            aria-pressed={mode === 'VERBAL_WITNESSED'}
            className={`flex min-h-primary w-full items-center gap-2 rounded-2xl border-2 px-3 text-start text-sm font-bold ${
              mode === 'VERBAL_WITNESSED' ? 'border-amber-500 bg-amber-50 text-[#3B2A00]' : 'border-ink/15 bg-white text-ink'
            }`}
          >
            <IconMic size={20} className="shrink-0" />
            {t('helper.consentVerbal')}
          </button>
        </div>

        {mode === 'VERBAL_WITNESSED' && (
          <div className="mt-3 rounded-2xl border-2 border-amber-400 bg-amber-50 p-3">
            <p className="flex items-start gap-1.5 text-xs font-semibold text-[#3B2A00]">
              <IconWarning size={16} className="mt-0.5 shrink-0" />
              {t('helper.consentVerbalWarning')}
            </p>

            <button
              type="button"
              onClick={() => (capture.state === 'recording' ? capture.stop() : void capture.start())}
              className={`mt-2 inline-flex min-h-primary w-full items-center justify-center gap-2 rounded-2xl border-2 text-sm font-bold ${
                capture.state === 'recording'
                  ? 'border-[#B42318] bg-[#B42318] text-white'
                  : capture.blob
                    ? 'border-[#0F7B3F] bg-[#0F7B3F]/10 text-[#0F7B3F]'
                    : 'border-ink/20 bg-white text-ink'
              }`}
            >
              <IconMic size={20} />
              {capture.state === 'recording'
                ? `${t('helper.recording')} ${capture.seconds}s`
                : capture.blob
                  ? t('common.recorded')
                  : t('helper.record')}
            </button>

            <label className="mt-2 flex items-start gap-2 text-xs font-semibold text-[#3B2A00]">
              <input
                type="checkbox"
                checked={attested}
                onChange={(e) => setAttested(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0"
              />
              {t('helper.attest')}
            </label>
          </div>
        )}
      </section>

      {created && mode === 'OTP' && (
        <section className="card mt-3 p-4">
          <p className="text-sm font-semibold text-ink">
            {lang === 'ur' ? 'شہری کے فون پر آیا کوڈ لکھیں' : "Enter the code sent to the citizen's phone"}
          </p>
          <input
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D+/g, '').slice(0, 6))}
            inputMode="numeric"
            className="num mt-2 text-center text-2xl tracking-[0.4em]"
            dir="ltr"
          />
          <TapButton block className="mt-3" disabled={busy || otp.length !== 6} onClick={() => void verifyOtp()}>
            {busy ? t('common.loading') : t('common.confirm')}
          </TapButton>
        </section>
      )}

      {!created && (
        <TapButton block className="mt-4" disabled={busy || !canSubmit} onClick={() => void createFamily()}>
          {busy ? t('common.loading') : t('helper.addFamily')}
        </TapButton>
      )}
    </div>
  );
}

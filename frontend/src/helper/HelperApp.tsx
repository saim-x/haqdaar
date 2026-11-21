import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { ScreenHeader } from '../shared/ui/ScreenHeader';
import { TapButton, TapLink } from '../shared/ui/TapButton';
import {
  IconCheck,
  IconChevronDown,
  IconMic,
  IconPlus,
  IconSearch,
  IconShield,
  IconUsers,
  IconWarning,
} from '../shared/ui/Icons';
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
 *
 * The roster is a list of people, so it is drawn as a list: one row per family,
 * hairline between them, the name carrying the weight. The consent state is a
 * dot and a word, not a coloured pill — a helper scanning forty rows needs to
 * see which two are blocked, and forty pills would hide them.
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
      void play(
        'helper_switch',
        t('helper.switchSpoken'),
      );
    },
    [actFor?.citizenId, lang, play, queryClient, setActFor],
  );

  return (
    <div className="screen">
      <ScreenHeader
        title={t('helper.title')}
        hint={t('helper.titleHint')}
        audioKey="helper_intro"
      />

      <div className="enter enter-2 mb-4 flex items-center gap-2 rounded-control border border-ink/[0.10] bg-card px-3 focus-within:border-accent">
        <IconSearch size={18} className="shrink-0 text-ink-3" />
        <label htmlFor="family-search" className="sr-only">
          {t('helper.search')}
        </label>
        <input
          id="family-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('helper.search')}
          className="min-h-tap flex-1 border-0 bg-transparent px-0 text-body-lg focus:ring-0"
        />
      </div>

      {families.isLoading && <p className="text-caption text-ink-3">{t('common.loading')}</p>}

      {families.isError && (
        <div className="card p-4">
          <p className="text-caption text-ink-2">{errorMessage(families.error, lang)}</p>
          <TapButton
            size="tap"
            variant="secondary"
            className="mt-3"
            onClick={() => void families.refetch()}
          >
            {t('common.tryAgain')}
          </TapButton>
        </div>
      )}

      {filtered.length > 0 && (
        <ul className="card enter enter-3 overflow-hidden">
          {filtered.map((family) => {
            const active = actFor?.citizenId === family.citizen_id;
            const locked = family.consent_status !== 'ACTIVE';
            return (
              <li
                key={family.citizen_id}
                className={`flex items-center border-b border-ink/[0.08] last:border-b-0 ${
                  active ? 'row-active' : ''
                }`}
                data-active={active ? 'true' : undefined}
              >
                <button
                  type="button"
                  disabled={switching}
                  onClick={() => void switchTo(family)}
                  aria-pressed={active}
                  className="press flex min-h-primary flex-1 items-center gap-3 px-4 py-3 text-start disabled:opacity-60"
                >
                  {/* A rounded square, not a circle: the circle is the speaker
                      button's shape, and two circles on one row read as two
                      buttons. The fill is a 12 % tint of the family's own hue
                      so the name stays the loudest thing in the row, and the
                      selection mark rides on the avatar instead of taking a
                      column of its own — a separate radio column squeezed the
                      consent line until "Consent active" broke in two. */}
                  <span className="relative shrink-0">
                    <span
                      aria-hidden
                      className="grid h-10 w-10 place-items-center rounded-control text-body-lg font-medium"
                      style={{
                        backgroundColor: `${family.avatar_color}1F`,
                        color: family.avatar_color,
                      }}
                    >
                      {family.full_name.slice(0, 1)}
                    </span>
                    {active && (
                      <span
                        aria-hidden
                        className="absolute -bottom-1 -end-1 grid h-4 w-4 place-items-center rounded-full bg-accent text-white ring-2 ring-card"
                      >
                        <IconCheck size={10} />
                      </span>
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-lg font-medium text-ink">
                      {family.full_name}
                    </span>
                    {/* The CNIC is isolated so its digits stay in order; the
                        district is ordinary Urdu and must not be dragged into
                        the same left-to-right run. */}
                    <span className="mt-0.5 flex items-center gap-1.5 text-meta text-ink-3">
                      <bdi className="num shrink-0">{family.cnic_masked ?? '—'}</bdi>
                      {family.district && (
                        <>
                          <span aria-hidden className="shrink-0 text-ink-3/60">
                            ·
                          </span>
                          <span className="truncate">{districtLabel(family.district, lang)}</span>
                        </>
                      )}
                    </span>
                    <span className="mt-1 flex items-center gap-2">
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <span
                          className={`live-dot ${locked ? 'bg-negative' : 'bg-positive'}`}
                          aria-hidden
                        />
                        <span
                          className={`text-meta ${locked ? 'text-negative' : 'text-ink-2'}`}
                        >
                          {locked ? t('helper.consentExpired') : t('helper.consentActive')}
                        </span>
                      </span>
                      {/* A blocked family's case count is not actionable, and
                          "Consent expired — renew" already fills the line. */}
                      {!locked && family.active_case_count > 0 && (
                        <span className="whitespace-nowrap text-meta tabular-nums text-ink-3">
                          · {family.active_case_count} {t('helper.openShort')}
                        </span>
                      )}
                    </span>
                  </span>
                </button>

                <AudioButton
                  className="me-3 shrink-0"
                  variant="quiet"
                  audioKey={null}
                  text={family.full_name}
                  label={`${t('common.listen')}: ${family.full_name}`}
                />
              </li>
            );
          })}
        </ul>
      )}

      {!families.isLoading && filtered.length === 0 && (
        <div className="card enter enter-3 px-5 py-10 text-center">
          <IconUsers size={28} className="mx-auto text-ink-3" />
          <p className="mt-3 text-body text-ink-2">
            {t('helper.empty')}
          </p>
        </div>
      )}

      <TapLink to="/h/new" block className="mt-5" icon={<IconPlus size={20} />}>
        {t('helper.addFamily')}
      </TapLink>

      {pending && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-paper px-6 text-center">
          <span
            aria-hidden
            className="grid h-24 w-24 place-items-center rounded-full text-display font-medium text-white"
            style={{ backgroundColor: pending.avatar_color }}
          >
            {pending.full_name.slice(0, 1)}
          </span>
          <p className="mt-6 text-caption text-ink-3">{t('helper.switchTitle')}</p>
          <h2 className="mt-1 text-title-lg font-medium text-ink">{pending.full_name}</h2>
          <AudioButton
            className="mt-4"
            audioKey="helper_switch"
            text={`${t('helper.switchTitle')} ${pending.full_name}`}
            size="lg"
          />
          <TapButton
            block
            className="mt-8 max-w-[420px]"
            icon={<IconCheck size={20} />}
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
            className="press mt-2 min-h-tap px-4 text-body text-ink-2 underline decoration-ink/20 underline-offset-4 hover:text-ink"
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
  const [showCnic, setShowCnic] = useState(false);
  const [mode, setMode] = useState<ConsentMode>('OTP');
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ citizenId: string; challengeId: string | null } | null>(
    null,
  );
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
      const res = await api.upload<{ citizen_id: string; challenge_id?: string | null }>(
        '/helper/families',
        payload,
      );
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
        <div className="card enter mt-8 px-6 py-10 text-center">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-positive-wash text-positive">
            <IconCheck size={32} />
          </span>
          <h1 className="mt-5 text-title font-medium text-ink">{fullName}</h1>
          <p className="mt-2 text-body leading-[1.7] text-ink-2">
            {mode === 'VERBAL_WITNESSED'
              ? t('helper.consentVerbalWarning')
              : t('helper.consentGranted')}
          </p>
          <TapButton block className="mt-6" onClick={() => navigate('/h', { replace: true })}>
            {t('helper.title')}
          </TapButton>
        </div>
      </div>
    );
  }

  return (
    <div className="screen pb-10">
      <ScreenHeader
        title={t('helper.addFamily')}
        hint={t('helper.addHint')}
        audioKey="helper_add_family"
        backTo="/h"
      />

      {error && (
        <div
          role="alert"
          className="enter mb-4 rounded-control border border-negative/25 bg-negative-wash px-4 py-3 text-caption font-medium text-negative"
        >
          {error}
        </div>
      )}

      <section className="card enter enter-2 p-5">
        <label htmlFor="family-name" className="block text-caption font-medium text-ink-2">
          {t('wizard.name.title')}
        </label>
        <input
          id="family-name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="mt-1.5"
          placeholder={t('helper.namePlaceholder')}
        />

        <p className="mt-5 text-caption font-medium text-ink-2">{t('wizard.payout.title')}</p>
        <div className="mt-1.5">
          <DigitPad
            value={digitsOnly(phoneDigits)}
            onChange={setPhoneDigits}
            maxDigits={11}
            format={(digits) => (digits ? digits.replace(/(\d{4})(\d{0,7})/, '$1 $2').trim() : '')}
            audioKey="wizard_payout_phone"
            audioText={t('wizard.payout.title')}
          />
        </div>

        {/* The CNIC is optional here, so it does not get a 300px keypad by
            default: two stacked pads pushed the consent choice — the most
            important decision on this screen — below the fold. */}
        <div className="mt-5 flex items-center justify-between gap-3">
          <p className="text-caption font-medium text-ink-2">
            {t('wizard.cnic.title')}
            <span className="ms-1.5 font-normal text-ink-3">{t('helper.optional')}</span>
          </p>
          <button
            type="button"
            onClick={() => {
              setShowCnic((prev) => !prev);
              if (showCnic) setCnicDigits('');
            }}
            aria-expanded={showCnic}
            className="press inline-flex min-h-tap shrink-0 items-center gap-1 rounded-control px-2 text-caption font-medium text-accent-ink hover:bg-raised"
          >
            {showCnic ? t('helper.remove') : t('helper.add')}
            <IconChevronDown
              size={14}
              className={`transition-transform duration-200 ${showCnic ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
        {showCnic && (
          <div className="enter mt-1.5">
            <DigitPad
              value={digitsOnly(cnicDigits)}
              onChange={setCnicDigits}
              maxDigits={13}
              format={formatCnic}
              onUnknown={() => setCnicDigits('')}
              audioKey="wizard_applicant_cnic"
              audioText={t('wizard.cnic.title')}
            />
          </div>
        )}

        <p className="mt-5 text-caption font-medium text-ink-2">{t('wizard.district.title')}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SINDH_DISTRICTS.map((item) => {
            const selected = district === item;
            return (
              <button
                key={item}
                type="button"
                onClick={() => setDistrict(item)}
                aria-pressed={selected}
                className={`press min-h-tap rounded-control border px-3 text-caption ${
                  selected
                    ? 'border-accent/40 bg-accent-wash font-medium text-accent-ink'
                    : 'border-ink/[0.10] bg-card text-ink-2 hover:bg-raised hover:text-ink'
                }`}
              >
                {districtLabel(item, lang)}
              </button>
            );
          })}
        </div>
      </section>

      <section className="card enter enter-3 mt-4 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-caption font-medium text-ink-2">{t('helper.consentCapture')}</h2>
          <AudioButton text="مدد کرنے سے پہلے اس خاندان کی اجازت لیں۔ فون پر کوڈ منگوائیں یا گواہ کے ساتھ زبانی اجازت ریکارڈ کریں۔" variant="quiet" />
        </div>

        <div className="mt-2 border-y border-ink/[0.08]">
          <button
            type="button"
            onClick={() => setMode('OTP')}
            aria-pressed={mode === 'OTP'}
            className="press flex min-h-primary w-full items-center gap-3 border-b border-ink/[0.08] px-1 text-start"
          >
            <IconShield
              size={20}
              className={`shrink-0 ${mode === 'OTP' ? 'text-accent-ink' : 'text-ink-3'}`}
            />
            <span
              className={`flex-1 text-body ${mode === 'OTP' ? 'font-medium text-ink' : 'text-ink-2'}`}
            >
              {t('helper.consentOtp')}
            </span>
            <span
              aria-hidden
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                mode === 'OTP' ? 'border-accent bg-accent text-white' : 'border-ink/20'
              }`}
            >
              {mode === 'OTP' && <IconCheck size={12} />}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setMode('VERBAL_WITNESSED')}
            aria-pressed={mode === 'VERBAL_WITNESSED'}
            className="press flex min-h-primary w-full items-center gap-3 px-1 text-start"
          >
            <IconMic
              size={20}
              className={`shrink-0 ${
                mode === 'VERBAL_WITNESSED' ? 'text-warn' : 'text-ink-3'
              }`}
            />
            <span
              className={`flex-1 text-body ${
                mode === 'VERBAL_WITNESSED' ? 'font-medium text-ink' : 'text-ink-2'
              }`}
            >
              {t('helper.consentVerbal')}
            </span>
            <span
              aria-hidden
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                mode === 'VERBAL_WITNESSED' ? 'border-warn bg-warn text-white' : 'border-ink/20'
              }`}
            >
              {mode === 'VERBAL_WITNESSED' && <IconCheck size={12} />}
            </span>
          </button>
        </div>

        {mode === 'VERBAL_WITNESSED' && (
          <div className="mt-4 rounded-control border border-warn/25 bg-warn-wash p-4">
            <p className="flex items-start gap-2 text-meta leading-[1.7] text-warn">
              <IconWarning size={16} className="mt-0.5 shrink-0" />
              {t('helper.consentVerbalWarning')}
            </p>

            <button
              type="button"
              onClick={() =>
                capture.state === 'recording' ? capture.stop() : void capture.start()
              }
              className={`press mt-3 inline-flex min-h-primary w-full items-center justify-center gap-2 rounded-control border text-body font-medium ${
                capture.state === 'recording'
                  ? 'border-transparent bg-negative text-white'
                  : capture.blob
                    ? 'border-positive/30 bg-positive-wash text-positive'
                    : 'border-ink/[0.14] bg-card text-ink hover:bg-raised'
              }`}
            >
              <IconMic size={20} />
              {capture.state === 'recording'
                ? `${t('helper.recording')} ${capture.seconds}s`
                : capture.blob
                  ? t('common.recorded')
                  : t('helper.record')}
            </button>

            <label className="mt-3 flex items-start gap-2.5 text-meta leading-[1.7] text-ink-2">
              <input
                type="checkbox"
                checked={attested}
                onChange={(e) => setAttested(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-accent"
              />
              {t('helper.attest')}
            </label>
          </div>
        )}
      </section>

      {created && mode === 'OTP' && (
        <section className="card enter mt-4 p-5">
          <p className="text-body text-ink">{t('helper.otpPrompt')}</p>
          <input
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D+/g, '').slice(0, 6))}
            inputMode="numeric"
            aria-label={t('helper.code')}
            className="num mt-3 text-center font-mono text-title-lg tracking-[0.2em]"
            dir="ltr"
          />
          <TapButton
            block
            className="mt-3"
            disabled={busy || otp.length !== 6}
            onClick={() => void verifyOtp()}
          >
            {busy ? t('common.loading') : t('common.confirm')}
          </TapButton>
        </section>
      )}

      {!created && (
        <TapButton
          block
          className="mt-5"
          disabled={busy || !canSubmit}
          onClick={() => void createFamily()}
        >
          {busy ? t('common.loading') : t('helper.addFamily')}
        </TapButton>
      )}
    </div>
  );
}

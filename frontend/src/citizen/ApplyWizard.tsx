import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../shared/api/client';
import { ApiError, errorMessage } from '../shared/api/errors';
import type { CaseDocument, CaseView, ConsentGrant, DraftAnswer, DraftAnswers, Program } from '../shared/api/types';
import { useAudio, useAutoReadPrompt } from '../shared/audio/AudioProvider';
import { useAuth } from '../shared/auth/AuthProvider';
import { useI18n } from '../shared/i18n/I18nProvider';
import type { DictKey } from '../shared/i18n/dictionary';
import { useLiteMode } from '../shared/lite/LiteModeProvider';
import { clearDraft, db, draftKey, loadDraft, saveDraft } from '../shared/offline/db';
import { discardRow, enqueue } from '../shared/offline/outbox';
import { compressImage } from '../shared/lib/image';
import { digitsOnly, formatCnic, isCompleteCnic, isCompletePhone, toE164Pk } from '../shared/lib/cnic';
import { uuid } from '../shared/lib/uuid';
import { AudioButton } from '../shared/ui/AudioButton';
import { ProgressDots } from '../shared/ui/ProgressDots';
import { TapButton } from '../shared/ui/TapButton';
import {
  IconArrowLeft,
  IconArrowRight,
  IconCamera,
  IconCheck,
  IconCloud,
  IconDocument,
  IconLock,
  IconShield,
  IconWarning,
} from '../shared/ui/Icons';
import { Counter, DigitPad, DistrictList, IncomeBands, YearPicker } from './wizard/inputs';
import { VoiceField } from './wizard/VoiceField';

const STEPS = [
  'consent',
  'applicant_full_name',
  'applicant_cnic',
  'applicant_dob',
  'spouse_full_name',
  'spouse_cnic',
  'applicant_district',
  'children_under_18',
  'household_size',
  'monthly_income_pkr',
  'payout_phone',
  'cnic_doc',
  'death_cert_doc',
  'review',
] as const;

type StepKey = (typeof STEPS)[number];

const STEP_TITLE: Record<StepKey, DictKey> = {
  consent: 'wizard.consent.title',
  applicant_full_name: 'wizard.name.title',
  applicant_cnic: 'wizard.cnic.title',
  applicant_dob: 'wizard.dob.title',
  spouse_full_name: 'wizard.spouseName.title',
  spouse_cnic: 'wizard.spouseCnic.title',
  applicant_district: 'wizard.district.title',
  children_under_18: 'wizard.children.title',
  household_size: 'wizard.household.title',
  monthly_income_pkr: 'wizard.income.title',
  payout_phone: 'wizard.payout.title',
  cnic_doc: 'wizard.docCnic.title',
  death_cert_doc: 'wizard.docDeath.title',
  review: 'wizard.review.title',
};

const STEP_HINT: Partial<Record<StepKey, DictKey>> = {
  applicant_full_name: 'wizard.name.hint',
  applicant_cnic: 'wizard.cnic.hint',
  applicant_dob: 'wizard.dob.hint',
  spouse_cnic: 'wizard.spouseCnic.hint',
  payout_phone: 'wizard.payout.hint',
  cnic_doc: 'wizard.docCnic.hint',
  death_cert_doc: 'wizard.docDeath.hint',
};

const DEPT_CATEGORIES = ['IDENTITY', 'HOUSEHOLD', 'DOCUMENTS', 'PAYMENT', 'CASE_HISTORY'] as const;

function valueOf(answers: DraftAnswers, key: string): DraftAnswer | undefined {
  return answers[key];
}

function textOf(answers: DraftAnswers, key: string): string {
  const answer = valueOf(answers, key);
  if (!answer || answer.value === null || answer.value === undefined) return '';
  return String(answer.value);
}

function numberOf(answers: DraftAnswers, key: string, fallback = 0): number {
  const answer = valueOf(answers, key);
  if (!answer || answer.value === null || answer.value === undefined) return fallback;
  const parsed = Number(answer.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Guided application wizard — docs/11 §3.2, F-01..F-06.
 *
 * One question per screen, an audio prompt on every screen, a tap/keypad path
 * beside every voice path, and a draft that survives a dead battery: every step
 * is written to IndexedDB before the network is even attempted.
 */
export function ApplyWizard() {
  const { caseId = 'new' } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t, lang } = useI18n();
  const { session, actFor } = useAuth();
  const { lite } = useLiteMode();
  const { play } = useAudio();

  const citizenId = actFor?.citizenId ?? session?.citizen?.id ?? null;
  const actForCitizenId = actFor?.citizenId ?? null;

  const [serverCaseId, setServerCaseId] = useState<string | null>(caseId === 'new' ? null : caseId);
  const [programId, setProgramId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<DraftAnswers>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [consentGranted, setConsentGranted] = useState(false);
  const [docs, setDocs] = useState<{ cnic: CaseDocument | null; death: CaseDocument | null }>({
    cnic: null,
    death: null,
  });
  const [deathSkipped, setDeathSkipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [exactIncome, setExactIncome] = useState(false);
  const [exactDigits, setExactDigits] = useState('');
  const [uploading, setUploading] = useState<'cnic' | 'death' | null>(null);
  const [uploadNote, setUploadNote] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const pendingDocType = useRef<'CNIC_FRONT' | 'SPOUSE_DEATH_CERTIFICATE'>('CNIC_FRONT');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const step = STEPS[stepIndex] ?? 'consent';
  const total = STEPS.length;

  /* ------------------------------------------------------------- bootstrap */

  const programs = useQuery({
    queryKey: ['programs'],
    queryFn: () => api.get<{ items: Program[] }>('/programs'),
    staleTime: 10 * 60 * 1000,
  });

  const grants = useQuery({
    queryKey: ['consent', 'grants'],
    queryFn: () => api.get<{ items: ConsentGrant[] }>('/consent/grants'),
    staleTime: 30_000,
    retry: 1,
  });

  const existingCase = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => api.get<CaseView>(`/cases/${caseId}`),
    enabled: caseId !== 'new',
    retry: 1,
  });

  useEffect(() => {
    const first = programs.data?.items[0];
    if (first) setProgramId((prev) => prev ?? first.id);
  }, [programs.data]);

  // Hydrate from the server case, then from the local draft (local wins if newer).
  useEffect(() => {
    if (hydrated) return;
    const view = existingCase.data;
    if (caseId !== 'new' && !view) return;

    let cancelled = false;
    void (async () => {
      const local = await loadDraft(citizenId, caseId);
      if (cancelled) return;
      const serverAnswers = view?.draft_answers ?? {};
      const merged: DraftAnswers = { ...serverAnswers, ...(local?.answers ?? {}) };
      setAnswers(merged);
      if (view?.documents) {
        setDocs({
          cnic: view.documents.find((doc) => doc.doc_type === 'CNIC_FRONT') ?? null,
          death: view.documents.find((doc) => doc.doc_type === 'SPOUSE_DEATH_CERTIFICATE') ?? null,
        });
      }
      const savedStep = local?.wizardStep ?? view?.wizard_step ?? null;
      const index = savedStep ? STEPS.indexOf(savedStep as StepKey) : -1;
      if (index > 0) setStepIndex(index);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [caseId, citizenId, existingCase.data, hydrated]);

  // Skip the consent gate when a live department grant already exists.
  useEffect(() => {
    if (consentGranted) return;
    const active = grants.data?.items.some(
      (grant) =>
        grant.recipient_type === 'DEPARTMENT' &&
        grant.status === 'ACTIVE' &&
        grant.purposes.includes('BENEFIT_APPLICATION'),
    );
    if (active) setConsentGranted(true);
  }, [grants.data, consentGranted]);

  // Once consent is on record the gate has nothing left to ask.
  useEffect(() => {
    if (consentGranted && stepIndex === 0) setStepIndex(1);
  }, [consentGranted, stepIndex]);

  /* ------------------------------------------------------------ draft sync */

  const persist = useCallback(
    async (nextStep: string, nextAnswers: DraftAnswers) => {
      await saveDraft({
        localId: draftKey(citizenId, caseId),
        serverCaseId,
        citizenId,
        programId,
        wizardStep: nextStep,
        answers: nextAnswers,
        updatedAt: Date.now(),
        syncedAt: null,
      });
    },
    [caseId, citizenId, programId, serverCaseId],
  );

  const syncDraft = useCallback(
    async (nextStep: string, nextAnswers: DraftAnswers) => {
      await persist(nextStep, nextAnswers);
      if (!serverCaseId) return;
      const body = { wizard_step: nextStep, answers: nextAnswers };
      try {
        await api.patch(`/cases/${serverCaseId}/draft`, body);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
          // Coalesce: only the newest draft for this case needs to travel.
          const pending = await db.outbox.where('status').equals('PENDING').toArray();
          await Promise.all(
            pending.filter((row) => row.path === `/cases/${serverCaseId}/draft`).map((row) => discardRow(row.id)),
          );
          await enqueue({
            method: 'PATCH',
            path: `/cases/${serverCaseId}/draft`,
            body,
            citizenId,
            actForCitizenId,
            label: lang === 'ur' ? 'درخواست کا مسودہ' : 'Application draft',
          });
        }
      }
    },
    [actForCitizenId, citizenId, lang, persist, serverCaseId],
  );

  // Autosave on every answer change — local first, network second.
  useEffect(() => {
    if (!hydrated) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persist(step, answers);
    }, 250);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [answers, hydrated, persist, step]);

  /* --------------------------------------------------------------- answers */

  const setAnswer = useCallback(
    (key: string, value: DraftAnswer['value'], extra?: Partial<DraftAnswer>) => {
      setAnswers((prev) => ({
        ...prev,
        [key]: {
          value,
          confirmed: true,
          entered_by: actFor ? 'HELPER' : 'CITIZEN',
          missing_reason: null,
          ...extra,
        },
      }));
    },
    [actFor],
  );

  const markUnknown = useCallback(
    (key: string) => {
      setAnswers((prev) => ({
        ...prev,
        [key]: {
          value: null,
          confirmed: true,
          entered_by: actFor ? 'HELPER' : 'CITIZEN',
          missing_reason: 'USER_UNKNOWN',
        },
      }));
    },
    [actFor],
  );

  // Counters show a default the moment the step opens, so record it as the
  // answer — otherwise the citizen sees "1" and Next stays disabled.
  useEffect(() => {
    if (step === 'children_under_18' && !valueOf(answers, 'children_under_18')) {
      setAnswer('children_under_18', 0);
    } else if (step === 'household_size' && !valueOf(answers, 'household_size')) {
      setAnswer('household_size', 1);
    }
  }, [answers, setAnswer, step]);

  /* ---------------------------------------------------------------- consent */

  async function grantConsent() {
    setBusy(true);
    setError(null);
    try {
      const tenantId = session?.tenant?.id ?? null;
      await api.post<ConsentGrant>('/consent/grants', {
        recipient_type: 'DEPARTMENT',
        recipient_tenant_id: tenantId,
        recipient_user_id: null,
        categories: [...DEPT_CATEGORIES],
        purposes: ['BENEFIT_APPLICATION', 'PAYMENT_DISBURSEMENT'],
        assurance_level: 'SELF_OTP',
      });
      setConsentGranted(true);
      void queryClient.invalidateQueries({ queryKey: ['consent', 'grants'] });
    } catch (err) {
      setError(errorMessage(err, lang));
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------------------ case create */

  const ensureCase = useCallback(async (): Promise<string | null> => {
    if (serverCaseId) return serverCaseId;
    if (!programId) return null;
    try {
      const created = await api.post<CaseView>('/cases', {
        program_id: programId,
        case_type: 'BENEFIT_APPLICATION',
      });
      setServerCaseId(created.id);
      return created.id;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NETWORK_ERROR') return null;
      throw err;
    }
  }, [programId, serverCaseId]);

  useEffect(() => {
    if (!hydrated || !consentGranted || serverCaseId || caseId !== 'new') return;
    void ensureCase().catch((err: unknown) => setError(errorMessage(err, lang)));
  }, [caseId, consentGranted, ensureCase, hydrated, lang, serverCaseId]);

  /* -------------------------------------------------------------- documents */

  async function handleFile(file: File) {
    const docType = pendingDocType.current;
    setUploading(docType === 'CNIC_FRONT' ? 'cnic' : 'death');
    setUploadNote(null);
    setError(null);
    try {
      const compressed = await compressImage(file);
      const form = new FormData();
      form.append('file', compressed.blob, `${docType.toLowerCase()}.jpg`);
      form.append('doc_type', docType);
      if (serverCaseId) form.append('case_id', serverCaseId);

      let doc: CaseDocument;
      try {
        doc = await api.upload<CaseDocument>('/documents', form);
      } catch (err) {
        if (!(err instanceof ApiError) || err.code !== 'NETWORK_ERROR') throw err;
        await enqueue({
          method: 'POST',
          path: '/documents',
          blob: compressed.blob,
          blobField: 'file',
          formFields: { doc_type: docType, ...(serverCaseId ? { case_id: serverCaseId } : {}) },
          citizenId,
          actForCitizenId,
          label: docType === 'CNIC_FRONT' ? t('wizard.docCnic.title') : t('wizard.docDeath.title'),
        });
        doc = { id: uuid(), doc_type: docType, verify_status: 'PENDING' };
      }

      setDocs((prev) => (docType === 'CNIC_FRONT' ? { ...prev, cnic: doc } : { ...prev, death: doc }));
      setUploadNote(
        doc.verify_status === 'VERIFIED'
          ? t('wizard.doc.verified')
          : doc.verify_status === 'NEEDS_RETAKE' || doc.verify_status === 'UNVERIFIABLE'
            ? t('wizard.doc.unverifiable')
            : t('wizard.doc.checking'),
      );
      // Spoken retake feedback — docs/11 §3.2 step 12.
      if (doc.verify_status === 'NEEDS_RETAKE' || doc.verify_status === 'UNVERIFIABLE') {
        void play(null, lang === 'ur' ? doc.retake_reason_ur ?? t('wizard.doc.unverifiable') : doc.retake_reason_en ?? t('wizard.doc.unverifiable'));
      }
      if (docType === 'CNIC_FRONT') {
        setAnswer('cnic_doc_verified', doc.verify_status === 'VERIFIED');
      } else {
        setAnswer('death_cert_doc_verified', doc.verify_status === 'VERIFIED');
      }
    } catch (err) {
      setError(errorMessage(err, lang));
    } finally {
      setUploading(null);
    }
  }

  /* ----------------------------------------------------------------- submit */

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const id = await ensureCase();
      if (!id) {
        setError(
          lang === 'ur'
            ? 'انٹرنیٹ نہیں ہے۔ آپ کے جوابات اس فون پر محفوظ ہیں۔ سگنل آنے پر دوبارہ جمع کریں۔'
            : 'No connection. Your answers are saved on this phone. Submit again when the signal returns.',
        );
        return;
      }
      await api.patch(`/cases/${id}/draft`, { wizard_step: 'review', answers });
      await api.post(`/cases/${id}/submit`, {});
      await clearDraft(citizenId, caseId);
      setSubmitted(true);
      void queryClient.invalidateQueries({ queryKey: ['cases'] });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NETWORK_ERROR' && serverCaseId) {
        await enqueue({
          method: 'PATCH',
          path: `/cases/${serverCaseId}/draft`,
          body: { wizard_step: 'review', answers },
          citizenId,
          actForCitizenId,
          label: lang === 'ur' ? 'درخواست کا مسودہ' : 'Application draft',
        });
        await enqueue({
          method: 'POST',
          path: `/cases/${serverCaseId}/submit`,
          body: {},
          citizenId,
          actForCitizenId,
          label: lang === 'ur' ? 'درخواست جمع کرانا' : 'Submit application',
        });
        setQueued(true);
        setSubmitted(true);
      } else {
        setError(errorMessage(err, lang));
      }
    } finally {
      setBusy(false);
    }
  }

  /* -------------------------------------------------------------- navigation */

  const canAdvance = useMemo((): boolean => {
    switch (step) {
      case 'consent':
        return consentGranted;
      case 'applicant_full_name':
        return textOf(answers, 'applicant_full_name').trim().length >= 3;
      case 'applicant_cnic':
        return isCompleteCnic(textOf(answers, 'applicant_cnic'));
      case 'applicant_dob':
        return textOf(answers, 'applicant_dob').length > 0;
      case 'spouse_full_name':
        return textOf(answers, 'spouse_full_name').trim().length >= 3;
      case 'spouse_cnic': {
        const answer = valueOf(answers, 'spouse_cnic');
        return Boolean(answer) && (isCompleteCnic(textOf(answers, 'spouse_cnic')) || answer?.missing_reason === 'USER_UNKNOWN');
      }
      case 'applicant_district':
        return textOf(answers, 'applicant_district').length > 0;
      case 'children_under_18':
        return Boolean(valueOf(answers, 'children_under_18'));
      case 'household_size':
        return Boolean(valueOf(answers, 'household_size'));
      case 'monthly_income_pkr':
        return numberOf(answers, 'monthly_income_pkr', -1) >= 0;
      case 'payout_phone':
        return isCompletePhone(textOf(answers, 'payout_phone'));
      case 'cnic_doc':
        return Boolean(docs.cnic);
      case 'death_cert_doc':
        return Boolean(docs.death) || deathSkipped;
      case 'review':
        return true;
      default:
        return true;
    }
  }, [answers, consentGranted, deathSkipped, docs.cnic, docs.death, step]);

  const goNext = useCallback(() => {
    if (!canAdvance) return;
    const nextIndex = Math.min(stepIndex + 1, total - 1);
    const nextStep = STEPS[nextIndex] ?? 'review';
    setStepIndex(nextIndex);
    void syncDraft(nextStep, answers);
  }, [answers, canAdvance, stepIndex, syncDraft, total]);

  const goBack = useCallback(() => {
    setStepIndex((prev) => Math.max(0, prev - 1));
  }, []);

  useAutoReadPrompt(`wizard_${step}`, t(STEP_TITLE[step]));

  /* ------------------------------------------------------------------ render */

  if (submitted) {
    return (
      <div className="screen">
        <div className="card mt-6 p-6 text-center">
          <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-[#0F7B3F] text-white">
            <IconCheck size={44} />
          </span>
          <h1 className="mt-4 text-xl font-bold text-ink">{t('wizard.submitted')}</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            {queued
              ? t('wizard.review.offlineNote')
              : lang === 'ur'
                ? 'اب ہم آپ کی درخواست جانچیں گے۔ آپ کو پیغام ملے گا۔'
                : 'We will now check your application. You will get a message.'}
          </p>
          <AudioButton
            className="mx-auto mt-3"
            audioKey={queued ? 'wizard_queued' : 'wizard_submitted'}
            text={queued ? t('wizard.review.offlineNote') : t('wizard.submitted')}
          />
          <TapButton block className="mt-5" onClick={() => navigate('/c/cases', { replace: true })}>
            {t('home.cases')}
          </TapButton>
        </div>
      </div>
    );
  }

  const title = t(STEP_TITLE[step]);
  const hintKey = STEP_HINT[step];

  return (
    <div className="screen pb-28">
      <div className="mb-3 mt-1">
        <ProgressDots total={total} current={stepIndex} />
      </div>

      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="screen-title">{title}</h1>
          {hintKey && <p className="screen-hint">{t(hintKey)}</p>}
        </div>
        <AudioButton audioKey={`wizard_${step}`} text={title} size="lg" />
      </header>

      {!serverCaseId && (
        <div className="mb-3 flex items-start gap-2 rounded-2xl border-2 border-amber-400 bg-amber-50 px-3 py-2">
          <IconCloud size={18} className="mt-0.5 shrink-0 text-amber-700" />
          <p className="text-xs font-semibold text-[#3B2A00]">{t('wizard.review.offlineNote')}</p>
        </div>
      )}

      {error && (
        <div role="alert" className="mb-3 rounded-2xl border-2 border-[#B42318]/40 bg-[#B42318]/10 px-4 py-3 text-sm font-semibold text-[#B42318]">
          {error}
        </div>
      )}

      {/* ------------------------------------------------------------ consent */}
      {step === 'consent' && (
        <section className="card p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-teal-600/10 text-teal-700">
              <IconShield size={26} />
            </span>
            <p className="text-sm leading-relaxed text-ink">{t('wizard.consent.body')}</p>
          </div>
          <ul className="mt-3 space-y-1.5">
            {DEPT_CATEGORIES.map((category) => (
              <li key={category} className="flex items-center gap-2 text-xs font-semibold text-ink-soft">
                <IconCheck size={14} className="shrink-0 text-teal-700" />
                {lang === 'ur'
                  ? {
                      IDENTITY: 'شناخت',
                      HOUSEHOLD: 'گھریلو معلومات',
                      DOCUMENTS: 'دستاویزات',
                      PAYMENT: 'ادائیگی',
                      CASE_HISTORY: 'درخواست کی تاریخ',
                    }[category]
                  : {
                      IDENTITY: 'Identity',
                      HOUSEHOLD: 'Household',
                      DOCUMENTS: 'Documents',
                      PAYMENT: 'Payment',
                      CASE_HISTORY: 'Case history',
                    }[category]}
              </li>
            ))}
          </ul>
          <TapButton
            block
            className="mt-4"
            disabled={busy || consentGranted}
            icon={<IconCheck size={22} />}
            onClick={() => void grantConsent()}
          >
            {consentGranted ? t('wizard.consent.grant') : busy ? t('common.loading') : t('wizard.consent.grant')}
          </TapButton>
          <p className="mt-2 text-center text-[11px] text-ink-soft">
            {lang === 'ur' ? 'آپ کسی بھی وقت اجازت واپس لے سکتی ہیں۔' : 'You can take this back at any time.'}
          </p>
        </section>
      )}

      {/* --------------------------------------------------------------- name */}
      {step === 'applicant_full_name' && (
        <section className="card p-4">
          <label htmlFor="full-name" className="sr-only">
            {title}
          </label>
          <input
            id="full-name"
            value={textOf(answers, 'applicant_full_name')}
            onChange={(e) => setAnswer('applicant_full_name', e.target.value)}
            autoComplete="name"
            className="text-lg"
            placeholder={lang === 'ur' ? 'پورا نام' : 'Full name'}
          />
          <VoiceField
            fieldKey="applicant_full_name"
            audioKey="wizard_applicant_full_name"
            audioText={title}
            onConfirm={(value) => setAnswer('applicant_full_name', value === null ? '' : String(value))}
          />
        </section>
      )}

      {/* --------------------------------------------------------------- cnic */}
      {step === 'applicant_cnic' && (
        <section className="card p-4">
          <DigitPad
            value={digitsOnly(textOf(answers, 'applicant_cnic'))}
            onChange={(next) => setAnswer('applicant_cnic', next)}
            maxDigits={13}
            format={formatCnic}
            audioKey="wizard_applicant_cnic"
            audioText={title}
          />
          {textOf(answers, 'applicant_cnic').length > 0 && !isCompleteCnic(textOf(answers, 'applicant_cnic')) && (
            <p className="mt-2 text-xs font-semibold text-[#B42318]">{t('wizard.cnic.invalid')}</p>
          )}
          <VoiceField
            fieldKey="applicant_cnic"
            audioText={title}
            onConfirm={(value) => setAnswer('applicant_cnic', digitsOnly(String(value ?? '')))}
          />
        </section>
      )}

      {/* ---------------------------------------------------------------- dob */}
      {step === 'applicant_dob' && (
        <section className="card p-4">
          <YearPicker
            value={textOf(answers, 'applicant_dob').slice(0, 4) || null}
            onChange={(year) => setAnswer('applicant_dob', `${year}-01-01`)}
          />
          <p className="mt-2 text-[11px] text-ink-soft">
            {lang === 'ur' ? 'صرف سال کافی ہے۔' : 'The year is enough.'}
          </p>
          <VoiceField
            fieldKey="applicant_dob"
            audioText={title}
            onConfirm={(value) => setAnswer('applicant_dob', value === null ? null : String(value))}
          />
        </section>
      )}

      {/* -------------------------------------------------------- spouse name */}
      {step === 'spouse_full_name' && (
        <section className="card p-4">
          <label htmlFor="spouse-name" className="sr-only">
            {title}
          </label>
          <input
            id="spouse-name"
            value={textOf(answers, 'spouse_full_name')}
            onChange={(e) => setAnswer('spouse_full_name', e.target.value)}
            className="text-lg"
            placeholder={lang === 'ur' ? 'شوہر کا نام' : "Husband's name"}
          />
          <VoiceField
            fieldKey="spouse_full_name"
            audioText={title}
            onConfirm={(value) => setAnswer('spouse_full_name', value === null ? '' : String(value))}
          />
        </section>
      )}

      {/* -------------------------------------------------------- spouse cnic */}
      {step === 'spouse_cnic' && (
        <section className="card p-4">
          <DigitPad
            value={digitsOnly(textOf(answers, 'spouse_cnic'))}
            onChange={(next) => setAnswer('spouse_cnic', next)}
            maxDigits={13}
            format={formatCnic}
            unknown={valueOf(answers, 'spouse_cnic')?.missing_reason === 'USER_UNKNOWN'}
            onUnknown={() => markUnknown('spouse_cnic')}
            audioKey="wizard_spouse_cnic"
            audioText={title}
          />
          {valueOf(answers, 'spouse_cnic')?.missing_reason === 'USER_UNKNOWN' && (
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-[#3B2A00]">
              {lang === 'ur'
                ? 'ٹھیک ہے۔ ہم سرکاری ریکارڈ سے تصدیق کریں گے۔'
                : 'That is fine. We will check the government record instead.'}
            </p>
          )}
        </section>
      )}

      {/* ------------------------------------------------------------ district */}
      {step === 'applicant_district' && (
        <section className="card p-4">
          <DistrictList
            value={textOf(answers, 'applicant_district') || null}
            onChange={(district) => setAnswer('applicant_district', district)}
          />
        </section>
      )}

      {/* ------------------------------------------------------------ counters */}
      {step === 'children_under_18' && (
        <section className="card p-4">
          <Counter
            value={numberOf(answers, 'children_under_18')}
            onChange={(next) => setAnswer('children_under_18', next)}
            max={15}
            audioKey="wizard_children_under_18"
            audioText={title}
          />
        </section>
      )}

      {step === 'household_size' && (
        <section className="card p-4">
          <Counter
            value={numberOf(answers, 'household_size', 1)}
            onChange={(next) => setAnswer('household_size', next)}
            min={1}
            max={25}
            audioKey="wizard_household_size"
            audioText={title}
          />
        </section>
      )}

      {/* -------------------------------------------------------------- income */}
      {step === 'monthly_income_pkr' && (
        <section className="card p-4">
          <IncomeBands
            value={valueOf(answers, 'monthly_income_pkr') ? numberOf(answers, 'monthly_income_pkr') : null}
            onChange={(next) => setAnswer('monthly_income_pkr', next)}
            exact={exactIncome}
            onExactChange={setExactIncome}
            exactDigits={exactDigits}
            onExactDigits={setExactDigits}
          />
          <VoiceField
            fieldKey="monthly_income_pkr"
            audioText={title}
            onConfirm={(value) => setAnswer('monthly_income_pkr', value === null ? null : Number(value))}
          />
        </section>
      )}

      {/* -------------------------------------------------------------- payout */}
      {step === 'payout_phone' && (
        <section className="card p-4">
          {session?.user.phone && (
            <button
              type="button"
              onClick={() => setAnswer('payout_phone', toE164Pk(session.user.phone ?? ''))}
              className="mb-3 flex min-h-tap w-full items-center justify-center gap-2 rounded-2xl border-2 border-teal-600 bg-teal-50 text-sm font-bold text-teal-800"
            >
              <IconCheck size={18} />
              {t('wizard.payout.useMine')}
            </button>
          )}
          <DigitPad
            value={digitsOnly(textOf(answers, 'payout_phone'))}
            onChange={(next) => setAnswer('payout_phone', next ? toE164Pk(next) : '')}
            maxDigits={11}
            format={(digits) => (digits ? digits.replace(/(\d{4})(\d{0,7})/, '$1 $2').trim() : '')}
            audioKey="wizard_payout_phone"
            audioText={title}
          />
        </section>
      )}

      {/* ----------------------------------------------------------- documents */}
      {(step === 'cnic_doc' || step === 'death_cert_doc') && (
        <section className="card p-4">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = '';
            }}
          />

          {(() => {
            const doc = step === 'cnic_doc' ? docs.cnic : docs.death;
            const isUploading = uploading === (step === 'cnic_doc' ? 'cnic' : 'death');
            const verified = doc?.verify_status === 'VERIFIED';
            const retake = doc?.verify_status === 'NEEDS_RETAKE' || doc?.verify_status === 'UNVERIFIABLE';
            return (
              <>
                <div
                  className={`flex items-center gap-3 rounded-2xl border-2 px-3 py-3 ${
                    verified
                      ? 'border-[#0F7B3F] bg-[#0F7B3F]/10'
                      : retake
                        ? 'border-[#B42318] bg-[#B42318]/10'
                        : 'border-ink/15 bg-white'
                  }`}
                >
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white text-teal-700">
                    {verified ? <IconCheck size={26} className="text-[#0F7B3F]" /> : retake ? <IconWarning size={26} className="text-[#B42318]" /> : <IconDocument size={26} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-ink">
                      {isUploading
                        ? t('wizard.doc.checking')
                        : verified
                          ? t('wizard.doc.verified')
                          : retake
                            ? t('wizard.doc.unverifiable')
                            : doc
                              ? t('wizard.doc.checking')
                              : t('wizard.doc.takePhoto')}
                    </p>
                    {uploadNote && <p className="text-[11px] text-ink-soft">{uploadNote}</p>}
                  </div>
                  <AudioButton
                    audioKey={null}
                    text={
                      retake
                        ? lang === 'ur'
                          ? doc?.retake_reason_ur ?? t('wizard.doc.unverifiable')
                          : doc?.retake_reason_en ?? t('wizard.doc.unverifiable')
                        : t('wizard.docCnic.hint')
                    }
                  />
                </div>

                <TapButton
                  block
                  className="mt-3"
                  disabled={isUploading}
                  icon={<IconCamera size={22} />}
                  onClick={() => {
                    pendingDocType.current = step === 'cnic_doc' ? 'CNIC_FRONT' : 'SPOUSE_DEATH_CERTIFICATE';
                    fileRef.current?.click();
                  }}
                >
                  {doc ? t('wizard.doc.retake') : t('wizard.doc.takePhoto')}
                </TapButton>

                {!lite && (
                  <p className="mt-2 text-center text-[11px] text-ink-soft">
                    {lang === 'ur'
                      ? 'تصویر خود بخود چھوٹی کر دی جاتی ہے تاکہ کم سگنل پر بھی بھیجی جا سکے۔'
                      : 'Photos are shrunk automatically so they send even on a weak signal.'}
                  </p>
                )}

                {step === 'death_cert_doc' && (
                  <button
                    type="button"
                    onClick={() => {
                      setDeathSkipped(true);
                      markUnknown('death_cert_doc_verified');
                    }}
                    aria-pressed={deathSkipped}
                    className={`mt-3 min-h-tap w-full rounded-2xl border-2 text-sm font-bold ${
                      deathSkipped ? 'border-amber-500 bg-amber-100 text-[#3B2A00]' : 'border-ink/15 bg-white text-ink-soft'
                    }`}
                  >
                    {t('wizard.doc.skip')}
                  </button>
                )}
              </>
            );
          })()}
        </section>
      )}

      {/* -------------------------------------------------------------- review */}
      {step === 'review' && (
        <section className="card p-4">
          <div className="flex items-center gap-2">
            <AudioButton audioKey="wizard_review" text={t('wizard.review.title')} size="lg" />
            <p className="text-sm leading-relaxed text-ink-soft">
              {lang === 'ur'
                ? 'نیچے دیے گئے جوابات چیک کریں۔ ہر جواب کے ساتھ 🔊 دبا کر سن سکتی ہیں۔'
                : 'Check the answers below. Tap 🔊 beside any answer to hear it.'}
            </p>
          </div>

          <ul className="mt-3 divide-y divide-ink/10">
            {(
              [
                ['applicant_full_name', 'wizard.name.title'],
                ['applicant_cnic', 'wizard.cnic.title'],
                ['applicant_dob', 'wizard.dob.title'],
                ['spouse_full_name', 'wizard.spouseName.title'],
                ['spouse_cnic', 'wizard.spouseCnic.title'],
                ['applicant_district', 'wizard.district.title'],
                ['children_under_18', 'wizard.children.title'],
                ['household_size', 'wizard.household.title'],
                ['monthly_income_pkr', 'wizard.income.title'],
                ['payout_phone', 'wizard.payout.title'],
              ] as [string, DictKey][]
            ).map(([key, labelKey]) => {
              const answer = valueOf(answers, key);
              const unknown = answer?.missing_reason === 'USER_UNKNOWN';
              const raw = answer?.value;
              const display = unknown
                ? t('common.dontKnow')
                : raw === null || raw === undefined || raw === ''
                  ? '—'
                  : key === 'applicant_cnic' || key === 'spouse_cnic'
                    ? formatCnic(String(raw))
                    : key === 'monthly_income_pkr'
                      ? `PKR ${Number(raw).toLocaleString('en-PK')}`
                      : String(raw);
              return (
                <li key={key} className="flex items-center gap-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase text-ink-soft">{t(labelKey)}</p>
                    <p className="num truncate text-base font-bold text-ink" dir="auto">
                      {display}
                    </p>
                  </div>
                  <AudioButton audioKey={null} text={`${t(labelKey)}: ${display}`} />
                  <button
                    type="button"
                    onClick={() => {
                      const index = STEPS.indexOf(key as StepKey);
                      if (index >= 0) setStepIndex(index);
                    }}
                    className="min-h-tap shrink-0 rounded-xl px-2 text-xs font-bold text-teal-700"
                  >
                    {lang === 'ur' ? 'بدلیں' : 'Edit'}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex items-center gap-2 rounded-2xl bg-ink/[0.04] px-3 py-2">
            <IconLock size={16} className="shrink-0 text-ink-soft" />
            <p className="text-[11px] text-ink-soft">
              {lang === 'ur'
                ? 'آپ کی معلومات صرف محکمہ سماجی بہبود دیکھ سکتا ہے، اور صرف آپ کی اجازت سے۔'
                : 'Only the Social Welfare Department can see your data, and only with your permission.'}
            </p>
          </div>

          <TapButton
            block
            className="mt-4"
            disabled={busy}
            icon={<IconCheck size={22} />}
            onClick={() => void submit()}
          >
            {busy ? t('common.loading') : t('wizard.review.submit')}
          </TapButton>
        </section>
      )}

      {/* ------------------------------------------------------------ nav bar */}
      {step !== 'review' && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-white/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[520px] gap-2">
            <TapButton
              variant="secondary"
              size="tap"
              disabled={stepIndex === 0}
              icon={<IconArrowLeft size={18} className="rtl:rotate-180" />}
              onClick={goBack}
            >
              {t('common.back')}
            </TapButton>
            <TapButton
              block
              disabled={!canAdvance}
              icon={<IconArrowRight size={20} className="rtl:rotate-180" />}
              onClick={goNext}
            >
              {t('common.next')}
            </TapButton>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-white/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 backdrop-blur">
          <div className="mx-auto w-full max-w-[520px]">
            <TapButton variant="secondary" size="tap" block icon={<IconArrowLeft size={18} className="rtl:rotate-180" />} onClick={goBack}>
              {t('common.back')}
            </TapButton>
          </div>
        </div>
      )}

      {!canAdvance && step !== 'review' && step !== 'consent' && (
        <p className="mt-3 text-center text-xs font-semibold text-ink-soft">{t('wizard.missing')}</p>
      )}
    </div>
  );
}

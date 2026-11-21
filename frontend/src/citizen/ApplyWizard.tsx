import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { documentRetake, latestDocument } from './documentAttempts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../shared/api/client';
import { ApiError, errorMessage } from '../shared/api/errors';
import type { CaseDocument, CaseView, ConsentGrant, DraftAnswer, DraftAnswers, Program } from '../shared/api/types';
import { useAudio, useAutoReadPrompt } from '../shared/audio/AudioProvider';
import { AvatarPiPBubble } from '../shared/avatar/AvatarPiPBubble';
import { useAvatarGuide } from '../shared/avatar/useAvatarGuide';
import { useAuth } from '../shared/auth/AuthProvider';
import { useI18n } from '../shared/i18n/I18nProvider';
import type { DictKey } from '../shared/i18n/dictionary';
import { useLiteMode } from '../shared/lite/LiteModeProvider';
import { clearDraft, db, draftKey, loadDraft, saveDraft } from '../shared/offline/db';
import { discardRow, enqueue } from '../shared/offline/outbox';
import { compressImage } from '../shared/lib/image';
import {
  digitsOnly,
  formatCnic,
  isCompleteCnic,
  isCompletePhone,
  nationalPhoneDigits,
  toE164Pk,
} from '../shared/lib/cnic';
import { uuid } from '../shared/lib/uuid';
import { AudioButton } from '../shared/ui/AudioButton';
import { ProgressDots } from '../shared/ui/ProgressDots';
import { pkr } from '../shared/lib/money';
import { dayMonth } from '../shared/lib/dates';
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
import { DashboardBackLink } from './DashboardBackLink';
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

/**
 * docs/04 §5 - these facts are derived by the document verifier, never declared
 * by a citizen. The wizard keeps them locally for the review screen, but the
 * draft endpoint rejects the whole payload with `NOT_SELF_DECLARABLE` if they
 * travel, so they are stripped before every write.
 */
const DERIVED_FACTS = new Set(['cnic_doc_verified', 'death_cert_doc_verified']);

function declarableAnswers(answers: DraftAnswers): DraftAnswers {
  const out: DraftAnswers = {};
  for (const [key, answer] of Object.entries(answers)) {
    if (!DERIVED_FACTS.has(key)) out[key] = answer;
  }
  return out;
}

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
 * Guided application wizard - docs/11 §3.2, F-01..F-06.
 *
 * One question per screen, an audio prompt on every screen, a tap/keypad path
 * beside every voice path, and a draft that survives a dead battery: every step
 * is written to IndexedDB before the network is even attempted.
 */
export function ApplyWizard() {
  const { caseId = 'new' } = useParams<{ caseId: string }>();
  const [searchParams] = useSearchParams();
  const retakeStep = searchParams.get('retake');
  const resumeRequest = searchParams.get('resume') === 'request';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t, lang } = useI18n();
  const { session, actFor } = useAuth();
  const { lite } = useLiteMode();
  const { play } = useAudio();
  const guide = useAvatarGuide('wizard');

  const citizenId = actFor?.citizenId ?? session?.citizen?.id ?? null;
  const actForCitizenId = actFor?.citizenId ?? null;

  const isOfflineStart = searchParams.get('offline') === '1';
  const [serverCaseId, setServerCaseId] = useState<string | null>(
    caseId === 'new' || isOfflineStart ? null : caseId,
  );
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
  const [reference, setReference] = useState<string | null>(null);
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
    enabled: caseId !== 'new' && !isOfflineStart,
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
    if (caseId !== 'new' && !isOfflineStart && !view) return;

    let cancelled = false;
    void (async () => {
      const local = await loadDraft(citizenId, caseId);
      if (cancelled) return;
      const serverAnswers = view?.draft_answers ?? {};
      const merged: DraftAnswers = { ...serverAnswers, ...(local?.answers ?? {}) };
      setAnswers(merged);
      if (view?.documents) {
        setDocs({
          cnic: latestDocument(view, 'CNIC_FRONT'),
          death: latestDocument(view, 'SPOUSE_DEATH_CERTIFICATE'),
        });
      }
      const retake = view && documentRetake(view);
      const requestedStep = resumeRequest && view?.status === 'NEEDS_INFO' ? view.wizard_step : null;
      const savedStep = retake && retake.step === retakeStep
        ? retake.step
        : requestedStep ?? local?.wizardStep ?? view?.wizard_step ?? null;
      const index = savedStep ? STEPS.indexOf(savedStep as StepKey) : -1;
      if (index > 0) setStepIndex(index);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [caseId, citizenId, existingCase.data, hydrated, resumeRequest, retakeStep]);

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
      const body = { wizard_step: nextStep, answers: declarableAnswers(nextAnswers) };
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
            label: t('wizard.audio.draft'),
          });
        }
      }
    },
    [actForCitizenId, citizenId, lang, persist, serverCaseId],
  );

  // Autosave on every answer change - local first, network second.
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
  // answer - otherwise the citizen sees "1" and Next stays disabled.
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
      // A citizen has no endpoint to discover a department tenant id, so the
      // grant can only be (re)issued to a department already on record. When
      // there is none, the gate is an acknowledgement: POST /cases does not
      // require a pre-existing grant.
      const onRecord = grants.data?.items.find(
        (g) => g.recipient_type === 'DEPARTMENT' && g.recipient_tenant_id,
      );
      const tenantId = onRecord?.recipient_tenant_id ?? session?.tenant?.id ?? null;
      if (tenantId) {
        await api.post<ConsentGrant>('/consent/grants', {
          recipient_type: 'DEPARTMENT',
          recipient_tenant_id: tenantId,
          recipient_user_id: null,
          categories: [...DEPT_CATEGORIES],
          purposes: ['BENEFIT_APPLICATION', 'PAYMENT_DISBURSEMENT'],
          assurance_level: 'SELF_OTP',
        });
        void queryClient.invalidateQueries({ queryKey: ['consent', 'grants'] });
      }
      setConsentGranted(true);
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
    // The hidden input can also be triggered without the button (keyboard, AT),
    // so fall back to the step's document type instead of uploading "null".
    const docType =
      pendingDocType.current ?? (step === 'cnic_doc' ? 'CNIC_FRONT' : 'SPOUSE_DEATH_CERTIFICATE');
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
      // Spoken retake feedback - docs/11 §3.2 step 12. With the guide open the
      // coaching is face-to-face and `reassuring`: a blurry photo is a small
      // mistake, and the tone is what stops a citizen giving up here.
      if (doc.verify_status === 'NEEDS_RETAKE' || doc.verify_status === 'UNVERIFIABLE') {
        const retakeText =
          lang === 'ur'
            ? doc.retake_reason_ur ?? t('wizard.doc.unverifiable')
            : doc.retake_reason_en ?? t('wizard.doc.unverifiable');
        if (guide.active) {
          guide.speak({ text: retakeText, caption: retakeText, mood: 'reassuring' });
        } else {
          void play(null, retakeText);
        }
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
      await api.patch(`/cases/${id}/draft`, { wizard_step: 'review', answers: declarableAnswers(answers) });
      const view = await api.post<CaseView>(`/cases/${id}/submit`, {});
      setReference(view.reference_code);
      await clearDraft(citizenId, caseId);
      setSubmitted(true);
      void queryClient.invalidateQueries({ queryKey: ['cases'] });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NETWORK_ERROR' && serverCaseId) {
        await enqueue({
          method: 'PATCH',
          path: `/cases/${serverCaseId}/draft`,
          body: { wizard_step: 'review', answers: declarableAnswers(answers) },
          citizenId,
          actForCitizenId,
          label: t('wizard.audio.draft'),
        });
        await enqueue({
          method: 'POST',
          path: `/cases/${serverCaseId}/submit`,
          body: {},
          citizenId,
          actForCitizenId,
          label: t('wizard.audio.submit'),
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
        return Boolean(docs.cnic) && docs.cnic?.verify_status !== 'NEEDS_RETAKE';
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
    setUploadNote(null);
    setStepIndex(nextIndex);
    void syncDraft(nextStep, answers);
  }, [answers, canAdvance, stepIndex, syncDraft, total]);

  const goBack = useCallback(() => {
    setUploadNote(null);
    setStepIndex((prev) => Math.max(0, prev - 1));
  }, []);

  useAutoReadPrompt(`wizard_${step}`, t(STEP_TITLE[step]));

  /* ------------------------------------------------------------- video guide */

  /**
   * The PiP guide lip-syncs the step prompt this screen already ships as a
   * pre-cached MP3 - `wizard_<step>` - so opening her costs zero TTS calls and
   * zero vendor text. She is a mouth for a clip that already exists.
   */
  const lastSpokenStep = useRef<string | null>(null);
  useEffect(() => {
    if (!guide.active) {
      lastSpokenStep.current = null;
      return;
    }
    if (lastSpokenStep.current === step) return;
    lastSpokenStep.current = step;
    guide.speak({ text: t(STEP_TITLE[step]), mood: 'listening', clipKey: `wizard_${step}` });
  }, [guide.active, guide.speak, step, t]);

  /** Mandatory readback, spoken face-to-face when the guide is open. */
  const handleReadback = useCallback(
    (text: string): boolean => {
      if (!guide.active) return false;
      guide.speak({ text, caption: text, mood: 'listening' });
      return true;
    },
    [guide.active, guide.speak],
  );

  /**
   * Autosave runs on a 250ms debounce, so a citizen who types an answer and
   * immediately taps the way out would lose it. Flush the pending write first.
   */
  function saveBeforeLeaving() {
    if (!hydrated) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    void persist(step, answers).catch(() => undefined);
  }

  /* ------------------------------------------------------------------ render */

  if (submitted) {
    return (
      <div className="screen">
        <div className="mt-1">
          <DashboardBackLink />
        </div>
        <div className="card enter mt-4 p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-title font-medium leading-[1.35] text-ink">{t('wizard.submitted')}</h1>
              <p className="mt-1 text-body leading-[1.7] text-ink-2">
                {queued
                  ? t('wizard.review.offlineNote')
                  : lang === 'ur'
                    ? 'اب ہم آپ کی درخواست جانچیں گے۔ آپ کو پیغام ملے گا۔'
                    : 'We will now check your application. You will get a message.'}
              </p>
            </div>
            <AudioButton
              audioKey={queued ? 'wizard_queued' : 'wizard_submitted'}
              text={queued ? t('wizard.review.offlineNote') : t('wizard.submitted')}
            />
          </div>

          {reference && (
            <div className="mt-5 flex items-end justify-between gap-3 border-t border-ink/[0.08] pt-4">
              <div>
                <p className="text-meta text-ink-3">{t('cases.reference')}</p>
                <p className="num mt-0.5 font-mono text-title-lg font-medium text-ink" data-testid="wizard-reference">
                  {reference}
                </p>
              </div>
              <span className="stamp">{queued ? t('common.queued') : t('wizard.submitted')}</span>
            </div>
          )}

          <TapButton block className="mt-6" onClick={() => navigate('/c/cases', { replace: true })}>
            {t('home.cases')}
          </TapButton>
        </div>
      </div>
    );
  }

  const title = t(STEP_TITLE[step]);
  const hintKey = STEP_HINT[step];

  return (
    <div className="screen pb-28" data-testid="wizard" data-step={step}>
      <AvatarPiPBubble guide={guide} />
      {/* The tab bar steps aside for the whole flow and the bottom Back button
          is disabled on the first step, so without this a citizen who opened
          the form and changed her mind had no way out of it. */}
      <div className="mb-2 mt-1">
        <DashboardBackLink onClick={saveBeforeLeaving} />
      </div>
      <div className="mb-4 rounded-control bg-paper-2/70 p-2 border border-ink/[0.06]">
        <ProgressDots total={total} current={stepIndex} />
      </div>

      <header className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title font-medium leading-[1.35] text-ink">{title}</h1>
          {hintKey && <p className="mt-1 text-body leading-[1.7] text-ink-2">{t(hintKey)}</p>}
        </div>
        <AudioButton audioKey={`wizard_${step}`} text={title} size="lg" />
      </header>

      {!serverCaseId && (
        <div className="mb-4 flex items-start gap-2 rounded-control border border-warn/25 bg-warn-wash px-3 py-2.5">
          <IconCloud size={16} className="mt-1 shrink-0 text-warn" />
          <p className="text-meta leading-[1.7] text-warn">{t('wizard.review.offlineNote')}</p>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-control border border-negative/25 bg-negative-wash px-4 py-3 text-caption font-medium text-negative"
        >
          {error}
        </div>
      )}

      {/* ------------------------------------------------------------ consent */}
      {step === 'consent' && (
        <section className="card enter enter-2 p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-accent-wash text-accent-ink">
              <IconShield size={20} />
            </span>
            <p className="text-body leading-[1.7] text-ink">{t('wizard.consent.body')}</p>
          </div>

          <ul className="mt-4 border-y border-ink/[0.08]">
            {DEPT_CATEGORIES.map((category) => (
              <li
                key={category}
                className="flex items-center gap-2 border-b border-ink/[0.08] py-2 last:border-b-0"
              >
                <IconCheck size={14} className="shrink-0 text-ink-3" />
                <span className="text-caption text-ink-2">
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
                </span>
              </li>
            ))}
          </ul>

          {session?.user.role === 'HELPER' ? (
            <div className="mt-5 rounded-control bg-warn-wash p-3">
              <p className="text-caption text-ink-2">
                {grants.isPending ? t('common.loading') : grants.error ? errorMessage(grants.error, lang) : t('helper.departmentConsentNeeded')}
              </p>
              <TapButton variant="secondary" size="tap" className="mt-2" disabled={grants.isFetching} onClick={() => void grants.refetch()}>
                {t('helper.checkPermissions')}
              </TapButton>
            </div>
          ) : <>
          <TapButton
            block
            className="mt-5"
            disabled={busy || consentGranted}
            icon={<IconCheck size={20} />}
            onClick={() => void grantConsent()}
            data-testid="consent-grant"
          >
            {busy ? t('common.loading') : t('wizard.consent.grant')}
          </TapButton>
          <p className="mt-2 text-center text-meta text-ink-3">
            {t('wizard.consent.withdrawAnytime')}
          </p>
          </>}
        </section>
      )}

      {/* --------------------------------------------------------------- name */}
      {step === 'applicant_full_name' && (
        <section className="card enter enter-2 p-5">
          <label htmlFor="full-name" className="sr-only">
            {title}
          </label>
          <input
            id="full-name"
            value={textOf(answers, 'applicant_full_name')}
            onChange={(e) => setAnswer('applicant_full_name', e.target.value)}
            autoComplete="name"
            placeholder={t('wizard.name.placeholder')}
          />
          <VoiceField
            onReadback={handleReadback}
            fieldKey="applicant_full_name"
            valueText={textOf(answers, 'applicant_full_name')}
            onConfirm={(value) => setAnswer('applicant_full_name', value === null ? '' : String(value))}
          />
        </section>
      )}

      {/* --------------------------------------------------------------- cnic */}
      {step === 'applicant_cnic' && (
        <section className="card enter enter-2 p-5">
          <DigitPad
            value={digitsOnly(textOf(answers, 'applicant_cnic'))}
            onChange={(next) => setAnswer('applicant_cnic', next)}
            maxDigits={13}
            format={formatCnic}
          />
          {textOf(answers, 'applicant_cnic').length > 0 && !isCompleteCnic(textOf(answers, 'applicant_cnic')) && (
            <p className="mt-2 text-meta font-medium text-negative">{t('wizard.cnic.invalid')}</p>
          )}
          <VoiceField
            onReadback={handleReadback}
            fieldKey="applicant_cnic"
            onConfirm={(value) => setAnswer('applicant_cnic', digitsOnly(String(value ?? '')))}
          />
        </section>
      )}

      {/* ---------------------------------------------------------------- dob */}
      {step === 'applicant_dob' && (
        <section className="card enter enter-2 p-5">
          <label className="mb-3 block text-meta font-medium text-ink-2">
            {t('wizard.dob.exact')}
            <input
              type="date"
              dir="ltr"
              value={textOf(answers, 'applicant_dob')}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(event) => {
                const { value, validity } = event.currentTarget;
                if (validity.valid) setAnswer('applicant_dob', value);
              }}
              className="mt-1 block min-h-tap w-full rounded-control border border-ink/[0.14] bg-card px-3 text-body"
            />
          </label>
          <YearPicker
            value={textOf(answers, 'applicant_dob').slice(0, 4) || null}
            onChange={(year) => setAnswer('applicant_dob', `${year}-01-01`)}
          />
          <p className="mt-2 text-meta text-ink-3">
            {t('wizard.dob.yearEnough')}
          </p>
          <VoiceField
            onReadback={handleReadback}
            fieldKey="applicant_dob"
            valueText={textOf(answers, 'applicant_dob')}
            onConfirm={(value) => setAnswer('applicant_dob', value === null ? null : String(value))}
          />
        </section>
      )}

      {/* -------------------------------------------------------- spouse name */}
      {step === 'spouse_full_name' && (
        <section className="card enter enter-2 p-5">
          <label htmlFor="spouse-name" className="sr-only">
            {title}
          </label>
          <input
            id="spouse-name"
            value={textOf(answers, 'spouse_full_name')}
            onChange={(e) => setAnswer('spouse_full_name', e.target.value)}
            placeholder={t('wizard.spouseName.placeholder')}
          />
          <VoiceField
            onReadback={handleReadback}
            fieldKey="spouse_full_name"
            valueText={textOf(answers, 'spouse_full_name')}
            onConfirm={(value) => setAnswer('spouse_full_name', value === null ? '' : String(value))}
          />
        </section>
      )}

      {/* -------------------------------------------------------- spouse cnic */}
      {step === 'spouse_cnic' && (
        <section className="card enter enter-2 p-5">
          <DigitPad
            value={digitsOnly(textOf(answers, 'spouse_cnic'))}
            onChange={(next) => setAnswer('spouse_cnic', next)}
            maxDigits={13}
            format={formatCnic}
            unknown={valueOf(answers, 'spouse_cnic')?.missing_reason === 'USER_UNKNOWN'}
            onUnknown={() => markUnknown('spouse_cnic')}
          />
          {valueOf(answers, 'spouse_cnic')?.missing_reason === 'USER_UNKNOWN' && (
            <p className="mt-3 rounded-control bg-warn-wash px-3 py-2.5 text-meta leading-[1.7] text-warn">
              {lang !== 'en'
                ? 'ٹھیک ہے۔ ہم سرکاری ریکارڈ سے تصدیق کریں گے۔'
                : 'That is fine. We will check the government record instead.'}
            </p>
          )}
          <VoiceField
            onReadback={handleReadback}
            fieldKey="spouse_cnic"
            onConfirm={(value, missingReason) => {
              if (missingReason === 'USER_UNKNOWN' || value === null) markUnknown('spouse_cnic');
              else setAnswer('spouse_cnic', digitsOnly(String(value)));
            }}
          />
        </section>
      )}

      {/* ------------------------------------------------------------ district */}
      {step === 'applicant_district' && (
        <section className="card enter enter-2 p-5">
          <DistrictList
            value={textOf(answers, 'applicant_district') || null}
            onChange={(district) => setAnswer('applicant_district', district)}
          />
          <VoiceField
            onReadback={handleReadback}
            fieldKey="applicant_district"
            valueText={textOf(answers, 'applicant_district')}
            onConfirm={(value) => {
              if (value) setAnswer('applicant_district', String(value));
            }}
          />
        </section>
      )}

      {/* ------------------------------------------------------------ counters */}
      {step === 'children_under_18' && (
        <section className="card enter enter-2 p-5">
          <Counter
            value={numberOf(answers, 'children_under_18')}
            onChange={(next) => setAnswer('children_under_18', next)}
            max={15}
          />
          <VoiceField
            onReadback={handleReadback}
            fieldKey="children_under_18"
            onConfirm={(value, missingReason) => {
              if (missingReason === 'USER_UNKNOWN' || value === null) markUnknown('children_under_18');
              else setAnswer('children_under_18', Math.max(0, Math.min(15, Number(value))));
            }}
          />
        </section>
      )}

      {step === 'household_size' && (
        <section className="card enter enter-2 p-5">
          <Counter
            value={numberOf(answers, 'household_size', 1)}
            onChange={(next) => setAnswer('household_size', next)}
            min={1}
            max={25}
          />
          <VoiceField
            onReadback={handleReadback}
            fieldKey="household_size"
            onConfirm={(value, missingReason) => {
              if (missingReason === 'USER_UNKNOWN' || value === null) markUnknown('household_size');
              else setAnswer('household_size', Math.max(1, Math.min(25, Number(value))));
            }}
          />
        </section>
      )}

      {/* -------------------------------------------------------------- income */}
      {step === 'monthly_income_pkr' && (
        <section className="card enter enter-2 p-5">
          <IncomeBands
            value={valueOf(answers, 'monthly_income_pkr') ? numberOf(answers, 'monthly_income_pkr') : null}
            onChange={(next) => setAnswer('monthly_income_pkr', next)}
            exact={exactIncome}
            onExactChange={setExactIncome}
            exactDigits={exactDigits}
            onExactDigits={setExactDigits}
          />
          <VoiceField
            onReadback={handleReadback}
            fieldKey="monthly_income_pkr"
            valueText={textOf(answers, 'monthly_income_pkr')}
            onConfirm={(value, missingReason) => {
              if (missingReason === 'USER_UNKNOWN' || value === null) markUnknown('monthly_income_pkr');
              else setAnswer('monthly_income_pkr', Number(value));
            }}
          />
        </section>
      )}

      {/* -------------------------------------------------------------- payout */}
      {step === 'payout_phone' && (
        <section className="card enter enter-2 p-5">
          {session?.user.phone && !session.user.phone.includes('*') && (
            <button
              type="button"
              onClick={() => setAnswer('payout_phone', toE164Pk(session.user.phone ?? ''))}
              className="press mb-3 flex min-h-tap w-full items-center justify-center gap-2 rounded-control border border-accent/40 bg-accent-wash text-caption font-medium text-accent-ink hover:border-accent/60"
            >
              <IconCheck size={16} />
              {t('wizard.payout.useMine')}
            </button>
          )}
          <DigitPad
            value={
              textOf(answers, 'payout_phone').startsWith('+92')
                ? `0${nationalPhoneDigits(textOf(answers, 'payout_phone'))}`
                : textOf(answers, 'payout_phone').replace(/\D+/g, '').slice(0, 11)
            }
            onChange={(next) => {
              if (!next) {
                setAnswer('payout_phone', '');
              } else if (isCompletePhone(next)) {
                setAnswer('payout_phone', toE164Pk(next));
              } else {
                setAnswer('payout_phone', next);
              }
            }}
            maxDigits={11}
            format={(digits) => (digits ? digits.replace(/(\d{4})(\d{0,7})/, '$1 $2').trim() : '')}
          />
          <VoiceField
            onReadback={handleReadback}
            fieldKey="payout_phone"
            onConfirm={(value) => {
              if (value) setAnswer('payout_phone', toE164Pk(String(value)));
            }}
          />
        </section>
      )}

      {/* ----------------------------------------------------------- documents */}
      {(step === 'cnic_doc' || step === 'death_cert_doc') && (
        <section className="card enter enter-2 p-5">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            data-testid="wizard-file"
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
                <div className="flex items-center gap-3 rounded-control border border-ink/[0.08] bg-raised px-3 py-3">
                  <span
                    aria-hidden
                    className={`live-dot ${verified ? 'bg-positive' : retake ? 'bg-negative' : 'bg-ink-3'}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-body font-medium text-ink">
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
                    {uploadNote && <p className="mt-0.5 text-meta text-ink-3">{uploadNote}</p>}
                  </div>
                  {verified ? (
                    <IconCheck size={18} className="shrink-0 text-positive" />
                  ) : retake ? (
                    <IconWarning size={18} className="shrink-0 text-negative" />
                  ) : (
                    <IconDocument size={18} className="shrink-0 text-ink-3" />
                  )}
                  <AudioButton
                    audioKey={null}
                    text={
                      retake
                        ? lang !== 'en'
                          ? (doc?.retake_reason_ur ?? t('wizard.doc.unverifiable'))
                          : (doc?.retake_reason_en ?? t('wizard.doc.unverifiable'))
                        : step === 'death_cert_doc'
                          ? t('wizard.docDeath.hint')
                          : t('wizard.docCnic.hint')
                    }
                  />
                </div>

                <TapButton
                  block
                  className="mt-3"
                  disabled={isUploading}
                  icon={<IconCamera size={20} />}
                  onClick={() => {
                    pendingDocType.current = step === 'cnic_doc' ? 'CNIC_FRONT' : 'SPOUSE_DEATH_CERTIFICATE';
                    fileRef.current?.click();
                  }}
                >
                  {doc ? t('wizard.doc.retake') : t('wizard.doc.takePhoto')}
                </TapButton>

                {!lite && (
                  <p className="mt-2 text-center text-meta leading-[1.7] text-ink-3">
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
                    className={`press mt-3 min-h-tap w-full rounded-control border text-caption font-medium ${
                      deathSkipped
                        ? 'border-warn/40 bg-warn-wash text-warn'
                        : 'border-ink/[0.14] bg-card text-ink-2 hover:bg-raised'
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
        <section className="card enter enter-2 p-5">
          <div className="flex items-center gap-3">
            <AudioButton audioKey="wizard_review" text={t('wizard.review.title')} variant="quiet" />
            <p className="text-caption leading-[1.7] text-ink-2">{t('wizard.review.hint')}</p>
          </div>

          <ul className="mt-4 border-y border-ink/[0.08]">
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
                  ? '-'
                  : key === 'applicant_cnic' || key === 'spouse_cnic'
                    ? formatCnic(String(raw))
                    : key === 'applicant_dob'
                      ? dayMonth(String(raw), lang)
                      : key === 'payout_phone'
                        ? String(raw).replace(/^(\d{4})(\d{7})$/, '$1-$2')
                        : key === 'monthly_income_pkr'
                          ? `PKR ${pkr(raw as number)}`
                          : String(raw);
              // Mono is the app's mark for a code. A name, a district and a
              // date are not codes, and setting them in mono made the review
              // list look like a printout of the database.
              const isCode =
                key === 'applicant_cnic' || key === 'spouse_cnic' || key === 'payout_phone';
              return (
                <li
                  key={key}
                  className="flex items-center gap-2 border-b border-ink/[0.08] py-2.5 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-meta text-ink-3">{t(labelKey)}</p>
                    <p
                      className={`mt-0.5 truncate text-body tabular-nums ${
                        isCode ? 'font-mono' : ''
                      } ${unknown ? 'text-ink-3' : 'text-ink'}`}
                    >
                      <bdi>{display}</bdi>
                    </p>
                  </div>
                  <AudioButton
                    audioKey={null}
                    text={`${t(labelKey)}: ${display}`}
                    variant="quiet"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const index = STEPS.indexOf(key as StepKey);
                      if (index >= 0) setStepIndex(index);
                    }}
                    className="press min-h-tap shrink-0 rounded-control px-1.5 text-meta font-medium text-ink-2 underline decoration-ink/25 underline-offset-4 hover:bg-raised hover:text-accent-ink"
                  >
                    {t('wizard.review.edit')}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex items-start gap-2 rounded-control bg-raised px-3 py-2.5">
            <IconLock size={16} className="mt-0.5 shrink-0 text-ink-3" />
            <p className="text-meta leading-[1.7] text-ink-2">
              {t('wizard.review.privacy')}
            </p>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------ nav bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/[0.08] bg-card/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-[560px] gap-2">
          <TapButton
            variant="secondary"
            size="tap"
            disabled={stepIndex === 0}
            icon={<IconArrowLeft size={18} />}
            onClick={goBack}
            data-testid="wizard-back"
          >
            {t('common.back')}
          </TapButton>
          {/* The primary action lives in the same place on every step. On the
              review step it used to sit at the end of the card, which left the
              bar holding a lone Back button and put Submit below ten rows of
              scrolling. */}
          {step === 'review' ? (
            <TapButton
              block
              disabled={busy}
              icon={<IconCheck size={20} />}
              onClick={() => void submit()}
              data-testid="wizard-submit"
            >
              {busy ? t('common.loading') : t('wizard.review.submit')}
            </TapButton>
          ) : (
            <TapButton
              block
              disabled={!canAdvance}
              icon={<IconArrowRight size={18} />}
              onClick={goNext}
              data-testid="wizard-next"
            >
              {t('common.next')}
            </TapButton>
          )}
        </div>
      </div>

      {!canAdvance && step !== 'review' && step !== 'consent' && (
        <p className="mt-3 text-center text-meta text-ink-3">{t('wizard.missing')}</p>
      )}
    </div>
  );
}

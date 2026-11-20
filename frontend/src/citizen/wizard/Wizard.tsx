import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, HelpCircle, ShieldCheck, Smartphone, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../shared/api/client';
import { programs } from '../../shared/api/endpoints';
import type { DraftAnswer } from '../../shared/api/types';
import { cleanName, parseChoice, parseCnic, parseNumber, parsePhone, parseYear } from '../../shared/voice/parse';
import { play } from '../../shared/audio';
import { useAuth } from '../../shared/auth/store';
import { formatPkr, useT } from '../../shared/i18n';
import type { DraftRow } from '../../shared/offline/db';
import { AudioButton } from '../../shared/ui/AudioButton';
import { Button } from '../../shared/ui/Button';
import { cx } from '../../shared/ui/cx';
import { PageLoader } from '../../shared/ui/Spinner';
import { useAutoRead } from '../useAutoRead';
import { grantConsentAndCreateCase, saveAnswer, setStep, useDraft } from './draftActions';
import { Counter, Keypad, PeopleDots } from './inputs';
import { PhotoStep } from './PhotoStep';
import { ReviewStep } from './ReviewStep';
import { DISTRICTS, formatCnic, INCOME_BANDS, isValidPkPhone, normalizePhone, stepsFor, type StepDef } from './steps';
import { VoiceCapture, type FieldParser, type VoiceResult } from './VoiceCapture';

export function Wizard() {
  const { localId } = useParams();
  const draft = useDraft(localId);
  const programsQ = useQuery({ queryKey: ['programs'], queryFn: programs.list, staleTime: 5 * 60_000 });
  const nav = useNavigate();

  useEffect(() => {
    if (draft === null) nav('/c/apply', { replace: true });
    if (draft?.submittedLocally) nav('/c/cases', { replace: true });
  }, [draft, nav]);

  const program = programsQ.data?.find((p) => p.id === draft?.programId);
  if (!draft || !program) return <PageLoader />;
  return <WizardInner draft={draft} programCode={program.code} programId={program.id} />;
}

function WizardInner({ draft, programCode, programId }: { draft: DraftRow; programCode: string; programId: string }) {
  const { t, lang } = useT();
  const programsQ = useQuery({ queryKey: ['programs'], queryFn: programs.list, staleTime: 5 * 60_000 });
  const program = programsQ.data!.find((p) => p.id === programId)!;
  const needsSpouse = programCode.includes('SAHARA') || program.required_documents.includes('SPOUSE_DEATH_CERTIFICATE');
  const steps = useMemo(() => stepsFor(program.required_documents, needsSpouse), [program.required_documents, needsSpouse]);

  let index = Math.max(0, steps.findIndex((s) => s.id === draft.wizardStep));
  if (steps[index]?.kind === 'consent' && draft.consentGranted) index = 1;
  const step = steps[index];
  const go = (i: number) => void setStep(draft.localId, steps[Math.max(0, Math.min(steps.length - 1, i))].id);
  const next = () => go(index + 1);
  const back = () => go(index - 1);
  const BackIcon = lang === 'ur' ? ArrowRight : ArrowLeft;

  return (
    <div className="animate-rise" key={step.id}>
      <nav aria-label={t('stepOf', { n: index + 1, total: steps.length })} className="mb-5">
        <div className="flex items-center gap-3">
          {index > 0 && (
            <button
              type="button"
              onClick={back}
              aria-label={t('back')}
              className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-line-strong bg-surface"
            >
              <BackIcon className="h-6 w-6" aria-hidden />
            </button>
          )}
          <ol className="flex flex-1 items-center gap-1" aria-hidden>
            {steps.map((s, i) => (
              <li
                key={s.id}
                className={cx(
                  'h-2.5 flex-1 rounded-full transition-colors duration-base',
                  i < index ? 'bg-brand' : i === index ? 'bg-accent' : 'bg-line',
                )}
              />
            ))}
          </ol>
          <span className="num shrink-0 text-sm font-semibold text-muted">
            {index + 1}/{steps.length}
          </span>
        </div>
      </nav>

      <StepBody
        step={step}
        draft={draft}
        programId={programId}
        onNext={next}
        onJump={(id) => void setStep(draft.localId, id)}
        steps={steps}
        nextId={steps[Math.min(index + 1, steps.length - 1)].id}
      />
    </div>
  );
}

function Frame({ step, children, extraAudio }: { step: StepDef; children: ReactNode; extraAudio?: string }) {
  const { t } = useT();
  const text = `${t(step.question)}${extraAudio ? `. ${extraAudio}` : ''}`;
  useAutoRead(step.clip, text, [step.id]);
  return (
    <section aria-labelledby="q" className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 id="q" className="text-[1.75rem] font-bold leading-snug">
            {t(step.question)}
          </h1>
          {step.hint && <p className="mt-1 text-lg text-muted">{t(step.hint)}</p>}
        </div>
        <AudioButton clip={step.clip} text={text} label={t(step.question)} />
      </div>
      {children}
    </section>
  );
}

function NextBar({ onNext, disabled, label, loading }: { onNext: () => void; disabled?: boolean; label?: string; loading?: boolean }) {
  const { t, lang } = useT();
  const Icon = lang === 'ur' ? ArrowLeft : ArrowRight;
  return (
    <div className="sticky bottom-3 pt-2">
      <Button size="xl" block onClick={onNext} disabled={disabled} loading={loading} className="shadow-lift">
        {label ?? t('next')}
        {!loading && <Icon className="h-7 w-7" aria-hidden />}
      </Button>
    </div>
  );
}

interface BodyProps {
  step: StepDef;
  draft: DraftRow;
  programId: string;
  steps: StepDef[];
  nextId: string;
  onNext: () => void;
  onJump: (id: string) => void;
}

function StepBody(props: BodyProps) {
  const { step } = props;
  switch (step.kind) {
    case 'consent':
      return <ConsentStep {...props} />;
    case 'photo':
      return (
        <Frame step={step}>
          <PhotoStep step={step} draft={props.draft} onNext={props.onNext} />
        </Frame>
      );
    case 'review':
      return (
        <Frame step={step}>
          <ReviewStep steps={props.steps} draft={props.draft} onJump={props.onJump} />
        </Frame>
      );
    default:
      return <AnswerStep {...props} />;
  }
}

function ConsentStep({ step, draft, programId, nextId }: BodyProps) {
  const { t, pick } = useT();
  const programsQ = useQuery({ queryKey: ['programs'], queryFn: programs.list, staleTime: 5 * 60_000 });
  const program = programsQ.data!.find((p) => p.id === programId)!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = [
    { label: t('q_consent_who'), value: 'Social Protection Department (Mock) · محکمہ سماجی تحفظ' },
    { label: t('q_consent_what'), value: `${t('cat_IDENTITY')} · ${t('cat_HOUSEHOLD')} · ${t('cat_DOCUMENTS')} · ${t('cat_PAYMENT')}` },
    { label: t('q_consent_why'), value: pick(program.name_ur, program.name) },
  ];
  return (
    <Frame step={step} extraAudio={t('q_consent_body')}>
      <div className="rounded-card border-2 border-consent/30 bg-consent-soft p-4">
        <ShieldCheck className="mb-2 h-10 w-10 text-consent" aria-hidden />
        <p className="text-lg leading-relaxed">{t('q_consent_body')}</p>
      </div>
      <dl className="card divide-y divide-line">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-col gap-0.5 p-4">
            <dt className="text-sm font-semibold text-muted">{r.label}</dt>
            <dd className="font-semibold">{r.value}</dd>
          </div>
        ))}
        <div className="flex items-center gap-2 p-4 font-semibold text-consent">
          <Undo2 className="h-5 w-5" aria-hidden />
          {t('q_consent_takeback')}
        </div>
      </dl>
      {error && (
        <p role="alert" className="rounded-control bg-danger-soft p-3 font-medium text-danger">
          {error}
        </p>
      )}
      <NextBar
        label={t('q_consent_grant')}
        loading={busy}
        onNext={async () => {
          setBusy(true);
          setError(null);
          try {
            await grantConsentAndCreateCase(draft, program, nextId);
          } catch (e) {
            setError(e instanceof ApiError ? pick(e.messageUr, e.message) : t('somethingWrong'));
          } finally {
            setBusy(false);
          }
        }}
      />
    </Frame>
  );
}

function initialValue(a: DraftAnswer | undefined): string {
  if (!a || a.value === null || a.value === undefined) return '';
  return String(a.value);
}

function AnswerStep({ step, draft, onNext, nextId }: BodyProps) {
  const { t, lang, pick } = useT();
  const { user } = useAuth();
  const existing = draft.answers[step.id];
  const [value, setValue] = useState<string>(initialValue(existing));
  const [error, setError] = useState<string | null>(null);
  const [exactIncome, setExactIncome] = useState<boolean>(
    !!existing?.value && !INCOME_BANDS.some((b) => b.value === Number(existing.value)),
  );

  const commit = async (v: string | number | null, missing: DraftAnswer['missing_reason'] = null) => {
    await saveAnswer(draft.localId, step.id, { value: v, confirmed: true, missing_reason: missing }, nextId);
    onNext();
  };

  const fail = (msg: string, clip?: string) => {
    setError(msg);
    void play({ text: msg, lang, clip });
  };

  const onNextPressed = async () => {
    setError(null);
    switch (step.kind) {
      case 'text':
        if (value.trim().length < 2) return fail(t('missingStep'));
        return commit(value.trim());
      case 'cnic': {
        const d = value.replace(/\D/g, '');
        if (d.length !== 13) return fail(t('q_cnic_invalid'), 'cnic_invalid');
        return commit(d);
      }
      case 'dob': {
        const y = Number(value.slice(0, 4));
        const now = new Date().getFullYear();
        if (!y || y < 1920 || y > now - 10) return fail(t('missingStep'));
        return commit(value);
      }
      case 'district':
      case 'income':
        if (!value) return fail(t('missingStep'));
        return commit(step.kind === 'income' ? Number(value) : value);
      case 'counter':
        return commit(value === '' ? step.min ?? 0 : Number(value));
      case 'phone': {
        const p = normalizePhone(value);
        if (!isValidPkPhone(p)) return fail(t('missingStep'));
        return commit(p);
      }
      default:
        return commit(value);
    }
  };

  const onVoice = (r: VoiceResult) => {
    if (r.missing_reason === 'USER_UNKNOWN' && step.allowUnknown) return void commit(null, 'USER_UNKNOWN');
    if (r.value === null) return;
    setValue(String(r.value));
    void (async () => {
      await saveAnswer(draft.localId, step.id, { value: r.value, confirmed: true }, nextId);
      onNext();
    })();
  };

  // Field-scoped parsing of what the citizen actually said (no default answers).
  const parseVoice: FieldParser = (text) => {
    switch (step.kind) {
      case 'text': {
        const n = cleanName(text);
        return n ? { value: n, display: n } : null;
      }
      case 'cnic': {
        const d = parseCnic(text);
        return d ? { value: d, display: formatCnic(d) } : null;
      }
      case 'dob': {
        const y = parseYear(text);
        return y ? { value: y, display: y } : null;
      }
      case 'district': {
        const d = parseChoice(text, DISTRICTS);
        return d ? { value: d.value, display: pick(d.ur, d.value) } : null;
      }
      case 'counter': {
        const n = parseNumber(text);
        return n !== null && n >= (step.min ?? 0) && n <= (step.max ?? 30) ? { value: n, display: String(n) } : null;
      }
      case 'income': {
        const n = parseNumber(text);
        return n !== null && n >= 500 && n <= 5_000_000 ? { value: n, display: formatPkr(n, lang) } : null;
      }
      case 'phone': {
        const p = parsePhone(text);
        return p ? { value: p, display: p } : null;
      }
      default:
        return null;
    }
  };

  const voice = step.voice ? <VoiceCapture key={step.id} fieldKey={step.id} parse={parseVoice} allowUnknown={step.allowUnknown} onConfirm={onVoice} /> : null;
  const unknownBtn = step.allowUnknown && (
    <Button size="lg" variant="secondary" block icon={<HelpCircle className="h-6 w-6" aria-hidden />} onClick={() => void commit(null, 'USER_UNKNOWN')}>
      {t('iDontKnow')}
    </Button>
  );
  const errorEl = error && (
    <p role="alert" className="rounded-control border border-warn/40 bg-warn-soft p-3 text-center text-lg font-semibold text-warn">
      {error}
    </p>
  );

  let body: ReactNode = null;
  switch (step.kind) {
    case 'text':
      body = (
        <>
          {voice}
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-labelledby="q"
            autoComplete="off"
            className="min-h-tap-lg w-full rounded-control border-2 border-line-strong bg-surface px-4 text-2xl"
          />
        </>
      );
      break;
    case 'cnic': {
      const d = value.replace(/\D/g, '');
      body = (
        <>
          <output aria-live="polite" aria-labelledby="q" className="num block rounded-control border-2 border-line-strong bg-surface px-4 py-3 text-center text-3xl font-bold tracking-wider">
            {d ? formatCnic(d) : <span className="text-muted">XXXXX-XXXXXXX-X</span>}
            <span className="ms-2 text-base font-medium text-muted">({d.length}/13)</span>
          </output>
          {voice}
          <Keypad onDigit={(k) => d.length < 13 && setValue(d + k)} onBackspace={() => setValue(d.slice(0, -1))} />
          {unknownBtn}
        </>
      );
      break;
    }
    case 'dob': {
      const year = value.slice(0, 4);
      const age = year.length === 4 ? new Date().getFullYear() - Number(year) : null;
      body = (
        <>
          <output aria-live="polite" className="num block rounded-control border-2 border-line-strong bg-surface px-4 py-3 text-center text-4xl font-bold">
            {year || <span className="text-muted">YYYY</span>}
          </output>
          {age !== null && age > 0 && age < 120 && <p className="text-center text-xl font-semibold text-brand">{t('q_dob_age', { n: age })}</p>}
          {voice}
          <Keypad onDigit={(k) => year.length < 4 && setValue(year + k)} onBackspace={() => setValue(year.slice(0, -1))} />
          <label className="block text-muted">
            <span className="mb-1 block text-sm">{lang === 'ur' ? 'پوری تاریخ معلوم ہو تو (اختیاری)' : 'Exact date if known (optional)'}</span>
            <input
              type="date"
              value={value.length === 10 ? value : ''}
              onChange={(e) => setValue(e.target.value || year)}
              className="min-h-tap w-full rounded-control border-2 border-line-strong bg-surface px-3"
              dir="ltr"
            />
          </label>
        </>
      );
      break;
    }
    case 'district':
      body = (
        <>
          {voice}
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="q">
            {DISTRICTS.map((d) => (
              <div key={d.value} className="relative">
                <button
                  type="button"
                  role="radio"
                  aria-checked={value === d.value}
                  onClick={() => setValue(d.value)}
                  className={cx(
                    'flex min-h-[72px] w-full flex-col items-start justify-center rounded-control border-2 p-3 pe-12 text-start transition-colors duration-fast',
                    value === d.value ? 'border-brand bg-brand-soft' : 'border-line bg-surface',
                  )}
                >
                  <span className="font-urdu text-xl font-bold" lang="ur">
                    {d.ur}
                  </span>
                  <span className="text-sm text-muted" lang="en">
                    {d.value}
                  </span>
                </button>
                <div className="absolute end-2 top-1/2 -translate-y-1/2">
                  <AudioButton text={d.ur} lang="ur" size="md" clip={`district_${d.value.toLowerCase()}`} label={d.value} className="!h-10 !w-10" />
                </div>
              </div>
            ))}
          </div>
        </>
      );
      break;
    case 'counter': {
      const n = value === '' ? null : Number(value);
      body = (
        <>
          <Counter value={n} min={step.min} max={step.max} onChange={(v) => setValue(String(v))} />
          <PeopleDots n={n ?? 0} />
          {voice}
        </>
      );
      break;
    }
    case 'income':
      body = (
        <>
          {voice}
          {!exactIncome ? (
            <div className="space-y-2" role="radiogroup" aria-labelledby="q">
              {INCOME_BANDS.map((b, i) => (
                <div key={b.value} className="relative">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={Number(value) === b.value}
                    onClick={() => setValue(String(b.value))}
                    className={cx(
                      'flex min-h-[68px] w-full items-center gap-3 rounded-control border-2 p-3 pe-14 text-start',
                      Number(value) === b.value ? 'border-brand bg-brand-soft' : 'border-line bg-surface',
                    )}
                  >
                    <span className="flex gap-0.5" aria-hidden>
                      {Array.from({ length: i + 1 }).map((_, k) => (
                        <span key={k} className="inline-block h-7 w-3 rounded-sm bg-accent" />
                      ))}
                    </span>
                    <span className="text-xl font-bold">{pick(b.ur, b.en)}</span>
                  </button>
                  <div className="absolute end-2 top-1/2 -translate-y-1/2">
                    <AudioButton text={pick(b.ur, b.en)} clip={b.clip} size="md" className="!h-10 !w-10" />
                  </div>
                </div>
              ))}
              <Button variant="ghost" block onClick={() => setExactIncome(true)}>
                {t('q_income_exact')}
              </Button>
            </div>
          ) : (
            <>
              <output aria-live="polite" className="num block rounded-control border-2 border-line-strong bg-surface px-4 py-3 text-center text-4xl font-bold">
                {value ? formatPkr(Number(value), lang) : <span className="text-muted">0</span>}
              </output>
              <Keypad
                onDigit={(k) => value.length < 7 && setValue(value === '0' ? k : value + k)}
                onBackspace={() => setValue(value.slice(0, -1))}
              />
            </>
          )}
        </>
      );
      break;
    case 'phone': {
      const own = user?.phone;
      const d = value.replace(/[^\d+]/g, '');
      body = (
        <>
          {own && (
            <Button
              size="xl"
              variant={normalizePhone(value) === own ? 'primary' : 'secondary'}
              block
              icon={<Smartphone className="h-7 w-7" aria-hidden />}
              onClick={() => setValue(own)}
            >
              <span>{t('q_payout_own')}</span>
              <span className="num text-lg font-medium opacity-80">{own}</span>
            </Button>
          )}
          <output aria-live="polite" className="num block rounded-control border-2 border-line-strong bg-surface px-4 py-3 text-center text-3xl font-bold">
            {d || <span className="text-muted">03XX XXXXXXX</span>}
          </output>
          <Keypad onDigit={(k) => d.length < 13 && setValue(d + k)} onBackspace={() => setValue(d.slice(0, -1))} />
        </>
      );
      break;
    }
  }

  return (
    <Frame step={step}>
      {body}
      {errorEl}
      <NextBar onNext={() => void onNextPressed()} />
    </Frame>
  );
}

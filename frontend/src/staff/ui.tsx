import type { HTMLAttributes, ReactNode } from 'react';
import { ApiError } from '../shared/api/errors';
import { staffText } from './staffI18n';

/**
 * Staff console kit. English LTR, dense, keyboard-friendly.
 *
 * The console is where a decision has to be defensible, so the surfaces are
 * flatter and tighter than the citizen app: hairline rules instead of borders,
 * one type step per role, tabular figures everywhere a number can be compared.
 * Nothing here is filled with colour except a semantic dot - a screen with six
 * saturated pills has no hierarchy left to spend on the one row that matters.
 */

/**
 * Contract enums are not words. Every console screen that prints a status, a
 * route or a role goes through these maps, so the officer never reads
 * `HUMAN_REVIEW` and the auditor never reads a different spelling of it on the
 * next screen. The enum stays in the request body; the screen gets English.
 *
 * `humanize` is the fallback for a value the backend adds before this file
 * knows about it - it still reads as a sentence rather than shouting
 * snake_case, and it keeps the acronyms the domain actually uses.
 */
const ACRONYMS: Record<string, string> = {
  ai: 'AI',
  api: 'API',
  cnic: 'CNIC',
  dpi: 'DPI',
  en: 'EN',
  id: 'ID',
  nadra: 'NADRA',
  ocr: 'OCR',
  otp: 'OTP',
  pdf: 'PDF',
  pkr: 'PKR',
  qr: 'QR',
  rag: 'RAG',
  sms: 'SMS',
  tts: 'TTS',
  ur: 'UR',
  url: 'URL',
};

/**
 * `DATA_CONFLICT_INCOME` → "Data conflict income", `qr_signature_valid` →
 * "QR signature valid". The first letter is forced to upper case because the
 * backend is not consistent about it: enums arrive shouting, check names arrive
 * in snake_case, and a label that starts lower case reads like a fragment.
 */
export const humanize = (value: string) =>
  (value.charAt(0).toUpperCase() + value.slice(1).toLowerCase().replace(/_/g, ' ')).replace(
    /\b[a-z]+\b/gi,
    (w) => ACRONYMS[w.toLowerCase()] ?? w,
  );

const STATUS_WORD: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  PROCESSING: 'Processing',
  WAITING_EXTERNAL: 'Waiting for registry records',
  NEEDS_INFO: 'Waiting for the applicant',
  HUMAN_REVIEW: 'Ready to review',
  IN_REVIEW: 'In review',
  PENDING_SECOND_APPROVAL: 'Awaiting second approval',
  ON_HOLD_CONSENT: 'On hold - consent',
  APPROVED: 'Approved',
  PAYMENT_INITIATED: 'Payment initiated',
  PAID: 'Paid',
  PAYMENT_FAILED: 'Payment failed',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
  CLOSED: 'Closed',
};

const ROUTE_WORD: Record<string, string> = {
  AUTO_APPROVE: 'Auto approve',
  ASK_MORE: 'Ask for more',
  HUMAN_REVIEW: 'Human review',
  WAIT_EXTERNAL: 'Wait on external',
};

const JOB_WORD: Record<string, string> = {
  PENDING: 'Pending',
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  FAILED_RETRY: 'Failed, retrying',
  DEAD: 'Dead',
};

const ROLE_WORD: Record<string, string> = {
  CITIZEN: 'Citizen',
  HELPER: 'Helper',
  OFFICER: 'Officer',
  ADMIN: 'Admin',
  AUDITOR: 'Auditor',
};

const RULE_STATUS_WORD: Record<string, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};

const MOCK_MODE_WORD: Record<string, string> = {
  NORMAL: 'Normal',
  SLOW: 'Slow',
  FLAKY: 'Flaky',
  DOWN: 'Down',
};

const BAND_WORD: Record<string, string> = {
  URGENT: 'Urgent',
  HIGH: 'High',
  NORMAL: 'Normal',
  LOW: 'Low',
};

const RESULT_WORD: Record<string, string> = {
  PASS: 'Pass',
  FAIL: 'Fail',
  UNKNOWN: 'Unknown',
};

/**
 * docs/04 §5 - the 20 canonical fact keys, in the officer's vocabulary.
 *
 * `humanize` alone gets most of the way (`applicant_cnic` → "Applicant CNIC")
 * but not all of it: it renders `applicant_dob` as "Applicant dob" and
 * `death_cert_doc_verified` as "Death cert doc verified". These are the words
 * the officer uses out loud, so they are written down rather than derived.
 */
const FACT_LABEL: Record<string, string> = {
  applicant_cnic: 'Applicant CNIC',
  applicant_full_name: 'Applicant name',
  applicant_dob: 'Date of birth',
  applicant_age_years: 'Age',
  applicant_is_alive: 'Applicant alive',
  applicant_cnic_valid: 'CNIC not expired',
  applicant_district: 'District',
  marital_status_widow: 'Recorded as widowed',
  spouse_death_verified: 'Spouse death verified',
  spouse_full_name: 'Spouse name',
  spouse_cnic: 'Spouse CNIC',
  children_under_18: 'Children under 18',
  household_size: 'Household size',
  monthly_income_pkr: 'Monthly income',
  poverty_score: 'Poverty score',
  has_conflicting_active_grant: 'Another active grant',
  payout_phone: 'Payout phone',
  cnic_doc_verified: 'CNIC document verified',
  death_cert_doc_verified: 'Death certificate verified',
  citizen_has_active_dept_consent: 'Department consent active',
};

/** docs/04 §5 "Primary Sources". */
const SOURCE_WORD: Record<string, string> = {
  DOCUMENT_QR: 'Document QR',
  DOCUMENT_OCR: 'Document OCR',
  SELF_DECLARED: 'Self-declared',
  IDENTITY_REGISTRY: 'Identity registry',
  CIVIL_REGISTRY: 'Civil registry',
  HOUSEHOLD_SURVEY: 'Household survey',
  BENEFITS_REGISTRY: 'Benefits registry',
  DOCUMENT_VERIFIER: 'Document check',
  CONSENT_ENGINE: 'Consent engine',
  DERIVED: 'Derived',
};

const ENTERED_BY_WORD: Record<string, string> = {
  CITIZEN: 'Citizen',
  HELPER: 'Helper',
  OFFICER: 'Officer',
  SYSTEM: 'System',
};

/** docs/06 §2.2 - the complete operator set, as the symbols they mean. */
const OP_WORD: Record<string, string> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  in: 'in',
  not_in: 'not in',
};

/**
 * The same operators, spoken. A predicate in a trace is read as a formula
 * (`Monthly income ≤ 25,000`), so it takes the symbol; a rule being authored is
 * read as a sentence (`Operator: is at most`), so it takes the words. One enum,
 * two registers - both live here so they cannot drift apart.
 */
const OPERATOR_WORD: Record<string, string> = {
  eq: 'equals',
  neq: 'does not equal',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  in: 'is one of',
  not_in: 'is none of',
};

/** docs/06 §6 flag catalogue plus the §5.2 match outcome. */
const FLAG_WORD: Record<string, string> = {
  TAMPER_SUSPECTED: 'Document tamper suspected',
  DUPLICATE_APPLICATION: 'Duplicate application',
  IDENTITY_CONFLICT: 'Identity conflict',
  POSSIBLE_DUPLICATE_IDENTITY: 'Possible duplicate identity',
  APPLICANT_DECEASED: 'Applicant recorded deceased',
  PAYOUT_ACCOUNT_SHARED: 'Payout account shared',
  DATA_CONFLICT_INCOME: 'Income sources disagree',
  PAYOUT_NAME_MISMATCH: 'Payout name mismatch',
  IDENTITY_NAME_VARIANT_CHECK: 'Name variant needs a check',
  HELPER_HIGH_VELOCITY: 'Helper filing unusually fast',
  LOW_ASSURANCE_CONSENT: 'Low-assurance consent',
  CNIC_GENDER_MISMATCH: 'CNIC gender mismatch',
  CNIC_NOT_IN_REGISTRY: 'CNIC not in registry',
};

/** `agent_steps[].step` - the pipeline stages, in order. */
const STEP_WORD: Record<string, string> = {
  identity_lookup: 'Identity lookup',
  document_verify: 'Document check',
  household_survey: 'Household survey',
  benefits_check: 'Benefits check',
  rule_engine: 'Rule engine',
  anomaly_scan: 'Anomaly scan',
  priority_score: 'Priority score',
  explain: 'Explanation',
  OFFICER_DECISION: 'Officer decision',
};

const word = (map: Record<string, string>, value: string) => staffText(map[value] ?? humanize(value));

export const statusWord = (value: string) => word(STATUS_WORD, value);
export const routeWord = (value: string) => word(ROUTE_WORD, value);
export const jobWord = (value: string) => word(JOB_WORD, value);
export const roleWord = (value: string) => word(ROLE_WORD, value);
export const ruleStatusWord = (value: string) => word(RULE_STATUS_WORD, value);
export const mockModeWord = (value: string) => word(MOCK_MODE_WORD, value);
export const bandWord = (value: string) => word(BAND_WORD, value);
export const resultWord = (value: string) => word(RESULT_WORD, value);
export const factLabel = (value: string) => word(FACT_LABEL, value);
export const sourceWord = (value: string) => word(SOURCE_WORD, value);
export const enteredByWord = (value: string) => word(ENTERED_BY_WORD, value);
export const opWord = (value: string) => OP_WORD[value] ?? value;
export const operatorWord = (value: string) => OPERATOR_WORD[value] ?? value;
export const flagWord = (value: string) => word(FLAG_WORD, value);
export const stepWord = (value: string) => word(STEP_WORD, value);

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-ink/[0.08] pb-4">
      <div className="min-w-0">
        <h1 className="text-title-lg font-medium leading-[1.3] text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-caption text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  children,
  className = '',
  ...rest
}: { children: ReactNode; className?: string } & HTMLAttributes<HTMLElement>) {
  return (
    <section className={`card p-4 ${className}`} {...rest}>
      {children}
    </section>
  );
}

export function CardTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-body font-medium text-ink">{children}</h2>
      {hint && <span className="text-meta text-ink-3">{hint}</span>}
    </div>
  );
}

/** Three static skeleton rows. Nothing in the console is allowed to pulse. */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="py-6" role="status" aria-label={label}>
      <div className="space-y-2">
        {[0, 1, 2].map((row) => (
          <div key={row} className="h-9 rounded-control bg-raised" />
        ))}
      </div>
      <p className="mt-3 text-meta text-ink-3">{label}</p>
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const api = error instanceof ApiError ? error : null;
  return (
    <div
      role="alert"
      className="rounded-control border border-negative/25 bg-negative-wash px-4 py-3"
    >
      <p className="font-mono text-meta font-medium text-negative">{api?.code ?? 'ERROR'}</p>
      <p className="mt-1 text-caption text-ink">{api?.messageEn ?? String(error)}</p>
      {api?.requestId && (
        <p className="mt-1 font-mono text-meta text-ink-3">{staffText("request ")}{api.requestId}</p>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-control border border-dashed border-ink/[0.14] px-6 py-10 text-center text-caption text-ink-3">
      {children}
    </div>
  );
}

const BAND: Record<string, { dot: string; text: string }> = {
  URGENT: { dot: 'bg-negative', text: 'text-negative' },
  HIGH: { dot: 'bg-warn', text: 'text-warn' },
  NORMAL: { dot: 'bg-ink-3', text: 'text-ink-2' },
  LOW: { dot: 'bg-ink-3', text: 'text-ink-3' },
};

const BAND_FALLBACK = { dot: 'bg-ink-3', text: 'text-ink-2' };

/** Priority is a dot and a word. A filled red block would outrank the case name. */
export function PriorityBand({ band }: { band: string }) {
  const tone = BAND[band] ?? BAND_FALLBACK;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`live-dot ${tone.dot}`} aria-hidden />
      <span className={`text-meta ${tone.text}`}>{bandWord(band)}</span>
    </span>
  );
}

const CHIP_TONES: Record<string, string> = {
  neutral: 'border-ink/[0.12] text-ink-2',
  danger: 'border-negative/30 text-negative',
  warn: 'border-warn/30 text-warn',
  ok: 'border-positive/30 text-positive',
  info: 'border-info/30 text-info',
};

export function Chip({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'danger' | 'warn' | 'ok' | 'info';
  /** The machine value behind a humanized label, for officers who use the code. */
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-[6px] border px-1.5 py-0.5 text-meta ${CHIP_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * Confidence as a 2px track plus the number. The number is the fact; the track
 * is the glance. A null value stays a dash - never a zero-width bar, which would
 * read as "confidently wrong".
 */
export function ConfidenceBar({ value }: { value: number | null }) {
  if (value === null) return <span className="text-meta text-ink-3">{staffText("-")}</span>;
  const pct = Math.round(value * 100);
  const tone = value >= 0.9 ? 'bg-positive' : value >= 0.7 ? 'bg-warn' : 'bg-negative';
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-0.5 w-14 overflow-hidden rounded-full bg-ink/[0.10]">
        <span className={`block h-full ${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="num font-mono text-meta text-ink-2">{value.toFixed(2)}</span>
    </span>
  );
}

/**
 * A single number with its label. `bare` drops the card shell so a row of KPIs
 * can sit inside an existing card without becoming a grid of cards-in-cards.
 */
export function Kpi({
  label,
  value,
  hint,
  bare = false,
}: {
  label: string;
  value: string;
  hint?: string;
  bare?: boolean;
}) {
  return (
    <div className={bare ? undefined : 'card p-4'}>
      <p className="text-meta text-ink-3">{label}</p>
      <p className="num mt-1 text-display font-medium leading-[1.2] text-ink">{value}</p>
      {hint && <p className="mt-1 text-meta text-ink-3">{hint}</p>}
    </div>
  );
}

/** A label/value pair for detail panels. Value keeps its own direction. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-b border-ink/[0.06] py-2 last:border-b-0">
      <dt className="text-meta text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-caption text-ink">{children}</dd>
    </div>
  );
}

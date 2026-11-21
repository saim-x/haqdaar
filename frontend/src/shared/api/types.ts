/**
 * API DTOs — transcribed from docs/04 (data model) and docs/05 (contracts).
 * Do not add fields that are not in the frozen docs; request a contract change instead.
 */

export type Role = 'CITIZEN' | 'HELPER' | 'OFFICER' | 'ADMIN' | 'AUDITOR';

export type CaseStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'PROCESSING'
  | 'WAITING_EXTERNAL'
  | 'NEEDS_INFO'
  | 'HUMAN_REVIEW'
  | 'IN_REVIEW'
  | 'PENDING_SECOND_APPROVAL'
  | 'ON_HOLD_CONSENT'
  | 'APPROVED'
  | 'PAYMENT_INITIATED'
  | 'PAID'
  | 'PAYMENT_FAILED'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'CLOSED';

export type CaseType = 'BENEFIT_APPLICATION' | 'COMPLAINT';
export type RouteAction = 'AUTO_APPROVE' | 'ASK_MORE' | 'HUMAN_REVIEW' | 'WAIT_EXTERNAL';
export type DocumentType = 'CNIC_FRONT' | 'SPOUSE_DEATH_CERTIFICATE' | 'OTHER';
export type DocVerifyStatus = 'PENDING' | 'VERIFIED' | 'NEEDS_RETAKE' | 'UNVERIFIABLE' | 'TAMPER_SUSPECTED';
export type ConsentRecipientType = 'DEPARTMENT' | 'HELPER';
export type ConsentStatus = 'ACTIVE' | 'WITHDRAWN' | 'EXPIRED';
export type DataCategory = 'IDENTITY' | 'HOUSEHOLD' | 'DOCUMENTS' | 'PAYMENT' | 'CASE_HISTORY';
export type ConsentPurpose =
  | 'BENEFIT_APPLICATION'
  | 'PAYMENT_DISBURSEMENT'
  | 'HELPER_ASSISTANCE'
  | 'COMPLAINT_RESOLUTION';
export type ConsentAssurance = 'SELF_OTP' | 'CITIZEN_OTP' | 'VERBAL_WITNESSED';
export type ScamVerdict = 'VERIFIED_OFFICIAL' | 'LIKELY_SAFE' | 'CANNOT_TELL' | 'LIKELY_SCAM';
export type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED_RETRY' | 'DEAD';
export type PriorityBand = 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW';
export type FlagSeverity = 'HIGH' | 'MEDIUM' | 'LOW';
export type RuleStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type MockMode = 'NORMAL' | 'SLOW' | 'FLAKY' | 'DOWN';
export type FactState = 'KNOWN' | 'UNKNOWN';
export type RuleResult = 'PASS' | 'FAIL' | 'UNKNOWN';

export interface Tenant {
  id: string;
  code: string;
  name: string;
  name_ur: string;
}

export interface User {
  id: string;
  role: Role;
  email: string | null;
  phone: string | null;
  full_name: string;
  preferred_lang: 'ur' | 'en';
  tenant_id: string | null;
  is_active: boolean;
}

export interface Citizen {
  id: string;
  full_name: string;
  cnic_masked: string | null;
  phone_masked: string | null;
  district: string | null;
  avatar_color: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  expires_in?: number;
}

export interface LoginResponse extends AuthTokens {
  user: User;
  citizen?: Citizen | null;
  citizen_id?: string | null;
}

export interface MeResponse {
  user: User;
  citizen: Citizen | null;
  tenant: Tenant | null;
}

export interface Program {
  id: string;
  code: string;
  name: string;
  name_ur: string;
  description: string;
  description_ur: string;
  required_documents: DocumentType[];
  wizard_schema: WizardStepDef[];
  active_rule_version_id?: string | null;
}

/** `GET /programs` → `wizard_schema[]`. Server-driven wizard definition. */
export interface WizardStepDef {
  step: string;
  type:
    | 'CONSENT'
    | 'TEXT'
    | 'CNIC'
    | 'DATE'
    | 'DISTRICT'
    | 'COUNTER'
    | 'MONEY'
    | 'PHONE'
    | 'DOCUMENT'
    | 'REVIEW';
  fact_key?: string;
  required?: boolean;
  allow_unknown?: boolean;
  voice?: boolean;
  audio_key?: string;
  options?: string[];
  min?: number;
  max?: number;
  bands?: number[];
  doc_type?: DocumentType;
}

/**
 * Draft answer — docs/04 §5 fact object. The wizard PATCHes the narrow
 * `{value, confirmed, missing_reason}` subset; the server echoes the full object.
 */
export interface DraftAnswer {
  value: string | number | boolean | null;
  confirmed?: boolean;
  state?: FactState;
  source?: string | null;
  source_confidence?: number;
  entered_by?: 'CITIZEN' | 'HELPER' | 'SYSTEM';
  alternatives?: { value: string | number | boolean | null; source: string; entered_by: string }[];
  conflict?: boolean;
  missing_reason?: string | null;
}

export type DraftAnswers = Record<string, DraftAnswer>;

export interface CaseDocument {
  id: string;
  doc_type: DocumentType;
  verify_status: DocVerifyStatus;
  verify_confidence?: number | null;
  retake_reason_ur?: string | null;
  retake_reason_en?: string | null;
  verify_checks?: VerifyCheck[];
  extracted_fields?: Record<string, unknown>;
  created_at?: string;
}

export interface VerifyCheck {
  check: string;
  passed: boolean;
  value?: string | number | null;
  threshold?: string | number | null;
  detail?: string | null;
}

export interface CitizenExplanation {
  headline_ur: string;
  headline_en: string;
  reasons_ur: string[];
  reasons_en: string[];
  next_step_ur: string;
  next_step_en: string;
}

export interface TimelineEntry {
  at: string;
  label_ur: string;
  label_en: string;
}

export interface Payment {
  status: 'CREATED' | 'INITIATED' | 'COMPLETED' | 'FAILED';
  amount_pkr: number;
  external_ref: string | null;
  failure_reason?: string | null;
}

export interface CaseFlag {
  code: string;
  severity: FlagSeverity;
  detail?: string;
}

export interface AiCaseNote {
  verified: string[];
  uncertain: string[];
  suggested_checks: string[];
  summary_en: string;
  summary_ur: string;
}

export interface FactObject {
  state: FactState;
  value: string | number | boolean | null;
  source: string | null;
  source_confidence: number;
  entered_by: 'CITIZEN' | 'HELPER' | 'SYSTEM';
  alternatives: { value: string | number | boolean | null; source: string; entered_by: string }[];
  conflict: boolean;
  missing_reason: string | null;
}

/**
 * One entry of `decisions.rule_trace_json` — docs/04 §5 / docs/06 §2.
 *
 * The minimal shape (`rule_id`, `result`, `actual`, `expected`, `reason_ur`,
 * `reason_en`) is what the decision row always carries. The rule-DSL context
 * below is present only when the backend joins the trace to the rule version, so
 * every added field is optional and the renderer must work without them.
 */
export interface RuleTraceEntry {
  rule_id: string;
  result: RuleResult;
  actual: unknown;
  expected: unknown;
  reason_ur: string;
  reason_en: string;
  /** Canonical fact key this rule evaluated (docs/04 §5). */
  fact?: string;
  op?: string;
  value?: unknown;
  on_fail?: string;
  on_unknown?: string;
  required_for_auto?: boolean;
  label_en?: string;
  label_ur?: string;
  pass_reason_en?: string | null;
  pass_reason_ur?: string | null;
  fail_reason_en?: string | null;
  fail_reason_ur?: string | null;
  ask_prompt_en?: string | null;
  ask_prompt_ur?: string | null;
}

export interface ConfidenceComponents {
  identity: number;
  documents: number;
  data_consistency: number;
  consent_assurance: number;
  overall: number;
}

export interface CaseView {
  id: string;
  reference_code: string;
  program: { code: string; name: string; name_ur: string };
  case_type?: CaseType;
  status: CaseStatus;
  /** docs/04 §3.3 — the citizen-facing status string, server-supplied. */
  status_label?: { label_en: string; label_ur: string };
  previous_status?: CaseStatus | null;
  approved_amount_pkr: number | null;
  wizard_step: string | null;
  draft_answers: DraftAnswers;
  documents: CaseDocument[];
  citizen_explanation: CitizenExplanation | null;
  payment: Payment | null;
  timeline: TimelineEntry[];
  submitted_at?: string | null;
  decided_at?: string | null;
  created_at?: string;
  updated_at?: string;
  parent_case_id?: string | null;
  // Officer/auditor-only fields (absent on the citizen view).
  facts?: Record<string, FactObject>;
  rule_trace?: RuleTraceEntry[];
  flags?: CaseFlag[];
  ai_case_note?: AiCaseNote | null;
  latest_confidence?: number | null;
  latest_route?: RouteAction | null;
  latest_rule_version_id?: string | null;
  latest_rule_version?: { id: string; version_number: number; content_hash: string } | null;
  active_rule_version?: { id: string; version_number: number; content_hash: string } | null;
  priority_band?: PriorityBand;
  priority_score?: number;
  assigned_officer_id?: string | null;
  assigned_officer?: { id: string; full_name: string } | null;
  first_approver_id?: string | null;
  applicant?: { full_name: string; cnic_masked: string; district: string | null };
  agent_steps?: AgentStep[];
  escalation_reasons?: string[];
  ask_more_rounds?: number;
  requested_fields?: string[];
  tenant_id?: string;
  citizen_id?: string;
  submitted_by_user_id?: string | null;
  submitted_via_helper?: boolean;
  rule_stale?: boolean;
}

/** `GET /officer/cases/{case_id}` — CaseView plus the review-only extras. */
export interface OfficerCaseReview extends CaseView {
  citizen: { id: string; full_name: string; district: string | null; cnic_masked: string } | null;
  notes: TraceNote[];
  rule_stale: boolean;
}

export interface AgentStep {
  at: string;
  step: string;
  tool: string | null;
  status: 'OK' | 'FAILED' | 'SKIPPED';
  duration_ms: number;
  summary: string;
}

export interface CaseListResponse {
  items: CaseView[];
  total: number;
  limit: number;
  offset: number;
}

export interface ConsentGrant {
  id: string;
  citizen_id?: string;
  recipient_type: ConsentRecipientType;
  recipient_tenant_id: string | null;
  recipient_user_id: string | null;
  /** Embedded by the server so the UI never has to resolve a tenant id itself. */
  recipient_tenant?: { code: string; name: string; name_ur: string } | null;
  recipient_user?: { id: string; full_name: string } | null;
  categories: DataCategory[];
  purposes: ConsentPurpose[];
  status: ConsentStatus;
  assurance_level: ConsentAssurance;
  granted_at: string;
  expires_at: string | null;
  withdrawn_at: string | null;
  /** Present on `POST /consent/grants` — cases resumed from `ON_HOLD_CONSENT`. */
  resumed_case_ids?: string[];
}

export interface ConsentAccessLog {
  id: string;
  citizen_id: string;
  citizen_name: string | null;
  actor_role: Role;
  actor_label: string;
  tenant_id: string | null;
  category: DataCategory;
  purpose: ConsentPurpose;
  resource_ref: string;
  allowed: boolean;
  denial_reason: string | null;
  created_at: string;
}

export interface HelperFamily {
  citizen_id: string;
  full_name: string;
  avatar_color: string;
  cnic_masked: string | null;
  district: string | null;
  active_case_count: number;
  consent_status: ConsentStatus;
  consent_expires_at: string | null;
  grant_id: string | null;
}

export interface QueueItem {
  id: string;
  reference_code: string;
  status: CaseStatus;
  status_label: { label_en: string; label_ur: string };
  program: { code: string; name: string; name_ur: string };
  citizen_name: string;
  cnic_masked: string;
  district: string | null;
  priority_score: number;
  priority_band: PriorityBand;
  latest_confidence: number | null;
  latest_route: RouteAction | null;
  reason_codes: string[];
  assigned_officer_id: string | null;
  submitted_at: string | null;
  created_at: string;
  rule_stale: boolean;
}

export interface QueueResponse {
  items: QueueItem[];
  total: number;
  limit: number;
  offset: number;
  sort: string;
}

/** One eligibility rule inside `rules_json.eligibility_rules[]`. */
export interface RuleCondition {
  id: string;
  fact: string;
  op: string;
  value: string | number | boolean | null;
  on_fail: string;
  on_unknown: string;
  label_en: string;
  label_ur: string;
  ask_prompt_en: string | null;
  ask_prompt_ur: string | null;
  fail_reason_en: string;
  fail_reason_ur: string;
  pass_reason_en: string;
  pass_reason_ur: string;
  required_for_auto: boolean;
}

export interface RulesJson {
  schema_version: string;
  program_code: string;
  policy: {
    cost_matrix: {
      ask_more_cost: number;
      wrong_approval_cost: number;
      missed_fraud_multiplier: number;
      unnecessary_human_review_cost: number;
    };
    max_ask_more_rounds: number;
    auto_approve_max_amount_pkr: number;
    auto_approve_confidence_threshold: number;
  };
  benefit_formula: {
    base_amount_pkr: number;
    per_child_bonus_pkr: number;
    max_children_counted: number;
    hard_cap_pkr: number;
  };
  eligibility_rules: RuleCondition[];
}

export interface RuleVersion {
  id: string;
  program_id: string;
  version_number: number;
  status: RuleStatus;
  content_hash: string;
  change_note: string | null;
  rules_json: RulesJson;
  created_by?: string | null;
  published_by?: string | null;
  published_at?: string | null;
  created_at?: string;
}

/** `GET /admin/programs/{program_id}/rules`. */
export interface RulesResponse {
  program_id: string;
  program_code: string;
  active_rule_version_id: string | null;
  versions: RuleVersion[];
}

export interface RuleValidationResult {
  valid: boolean;
  errors: { field: string; message_en: string; message_ur: string }[];
  content_hash?: string;
  rule_count?: number;
}

export interface TwinFlippedCase {
  case_id: string;
  reference_code: string;
  before_outcome: string;
  after_outcome: string;
  before_amount_pkr: number | null;
  after_amount_pkr: number | null;
  reason_en: string;
  reason_ur: string;
}

export interface TwinResult {
  simulation_run_id: string;
  sample_size: number;
  before_counts: Record<string, number>;
  after_counts: Record<string, number>;
  flipped_cases: TwinFlippedCase[];
  budget_delta_pkr: number;
}

export interface AuditEvent {
  seq: number;
  id: string;
  tenant_id: string | null;
  actor_type: 'USER' | 'AI' | 'AGENT' | 'SYSTEM' | 'API_KEY';
  actor_id: string | null;
  actor_role: Role | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  request_id: string | null;
  payload: Record<string, unknown>;
  prev_hash: string;
  event_hash: string;
  created_at: string;
}

export interface AuditEventList {
  items: AuditEvent[];
  total: number;
  limit: number;
  offset: number;
}

export interface ChainVerifyResult {
  valid: boolean;
  checked_count: number;
  first_broken_seq: number | null;
  verified_at: string;
}

/** One row of `GET /auditor/cases/{case_id}/trace` → `decisions[]`. */
export interface TraceDecision {
  id: string;
  decision_source: 'AI_ENGINE' | 'OFFICER' | 'SECOND_OFFICER';
  rule_version_id: string;
  rule_content_hash: string;
  input_snapshot_hash: string;
  confidence_components: ConfidenceComponents;
  confidence_overall: number;
  route_action: RouteAction;
  outcome_status: CaseStatus;
  escalation_reasons: string[];
  model_versions: Record<string, string>;
  citizen_explanation: CitizenExplanation | null;
  computed_amount_pkr: number | null;
  officer_reason_codes: string[] | null;
  officer_note: string | null;
  is_override: boolean;
  created_at: string;
}

export interface TraceNote {
  id: string;
  note_type: string;
  body: string;
  metadata: Record<string, unknown>;
  is_visible_to_citizen: boolean;
  created_at: string;
}

/** `GET /auditor/cases/{case_id}/trace`. */
export interface DecisionTrace {
  case: {
    id: string;
    reference_code: string;
    status: CaseStatus;
    case_type: CaseType;
    tenant_id: string;
    citizen: { id: string; full_name: string; cnic_masked: string } | null;
    facts: Record<string, DraftAnswer>;
  };
  decisions: TraceDecision[];
  agent_steps: AgentStep[];
  notes: TraceNote[];
  events: AuditEvent[];
}

export interface ScamRedFlag {
  code: string;
  label_en: string;
  label_ur: string;
  severity?: 'HARD' | 'SOFT';
}

export interface ScamCheckResult {
  check_id: string;
  verdict: ScamVerdict;
  confidence: number;
  red_flags: ScamRedFlag[];
  matched_official: {
    notification_id: string;
    verification_code: string;
    program: string;
    created_at: string;
  } | null;
  explanation_ur: string;
  explanation_en: string;
  advice_ur: string;
  advice_en: string;
}

export interface Notification {
  id: string;
  channel: 'IN_APP' | 'SMS_SIMULATED';
  title_ur: string;
  title_en: string;
  body_ur: string;
  body_en: string;
  verification_code: string;
  case_id: string | null;
  read_at: string | null;
  created_at: string;
}

/** One provenance-tagged value inside `GET /me/data`. */
export interface MyDataValue {
  value: string | number | boolean | null;
  source: string;
}

/** `GET /me/data` — grouped view of everything stored about the citizen. */
export interface MyDataResponse {
  citizen_id: string;
  identity: Record<string, MyDataValue>;
  household: Record<string, MyDataValue>;
  case_history: {
    id: string;
    reference_code: string;
    status: CaseStatus;
    case_type: CaseType;
    created_at: string;
  }[];
  documents: {
    id: string;
    doc_type: DocumentType;
    verify_status: DocVerifyStatus;
    verify_confidence: number;
    mime_type: string;
    size_bytes: number;
    created_at: string;
    retake_reason_en: string | null;
    retake_reason_ur: string | null;
  }[];
  consents: ConsentGrant[];
  corrections: CorrectionRequest[];
  provenance_note_en: string;
  provenance_note_ur: string;
}

export interface CorrectionRequest {
  id: string;
  field_key: string;
  source_type: 'SELF_DECLARED' | 'REGISTRY';
  requested_value: unknown;
  status: 'APPLIED' | 'PENDING_OFFICER' | 'APPROVED' | 'REJECTED';
  applied: boolean;
  message_en: string;
  message_ur: string;
  created_at: string;
}

export interface Job {
  id: string;
  job_type: string;
  dedup_key: string | null;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_at: string | null;
  last_error: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface JobListResponse {
  items: Job[];
  total: number;
  limit: number;
  offset: number;
  queue_depth: Record<JobStatus, number>;
}

export interface MockServiceConfig {
  service_name: string;
  mode: MockMode;
  latency_ms: number;
  failure_rate: number;
  updated_at: string;
}

/** `GET /admin/mocks`. */
export interface MocksResponse {
  simulated: boolean;
  service_mode: string;
  services: MockServiceConfig[];
  count: number;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  rate_limit_per_min: number;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

export interface ApiKeyCreated extends ApiKeyRecord {
  api_key: string;
}

export interface EvalDashboard {
  decision_router_sweep: {
    threshold: number;
    auto_approve_rate: number;
    false_approval_rate: number;
    human_review_rate: number;
    expected_cost: number;
  }[];
  active_threshold: number;
  knee_threshold: number;
  sample_size: number;
  scam_classifier: {
    test_size: number;
    precision: number;
    recall: number;
    f1: number;
    false_positive_rate: number;
    hard_negative_fpr: number;
    confusion_matrix: number[][];
    live_checks_count: number;
    user_disputed_count: number;
  };
  document_verifier: {
    test_size: number;
    genuine_verified_rate: number;
    tampered_caught_rate: number;
    false_tamper_rate: number;
    blurry_retake_rate: number;
  };
  live_operations: {
    total_decisions: number;
    by_route: Record<string, number>;
    officer_override_rate: number;
    latency_p50_ms: number;
    latency_p95_ms: number;
    llm_calls_24h: number;
    llm_cost_usd_24h: number;
    llm_failure_rate: number;
  };
  benchmarks_available: boolean;
  program: { id: string; code: string; name: string } | null;
  dataset_note: string;
  generated_at: string;
}

export interface TenantAnalytics {
  tenant_id: string;
  cases_by_status: Record<string, number>;
  total_cases: number;
  decided_cases: number;
  avg_time_to_decision_seconds: number;
  auto_approve_pct: number;
  disbursed_pkr: number;
  top_flags: { code: string; count: number }[];
  open_cases: number;
}

export interface VoiceParseResult {
  field_key: string;
  transcript: string;
  parsed_value: string | number | boolean | null;
  confidence: number;
  readback_ur: string;
  readback_en: string;
  needs_retry: boolean;
  missing_reason?: string | null;
  provider?: string;
  model?: string;
  lang?: string;
  mime_type?: string;
}

export interface RagCitation {
  doc_title: string;
  section: string;
  version: string;
  excerpt: string;
  score: number;
}

export interface RagAnswer {
  status: 'ANSWERED' | 'NOT_SURE';
  answer: string;
  citations: RagCitation[];
  top_score: number;
  lang?: string;
  provider?: string;
  model?: string;
  guardrail_triggered?: boolean;
  retrieved?: number;
}

/** Three-way honesty badge — `backend/app/api/v1/transparency.py` `COMPONENTS`. */
export type TransparencyStatus = 'REAL' | 'SIMULATED' | 'SYNTHETIC';

/** `GET /transparency` — the Real vs Simulated table (docs/15 §1). */
export interface TransparencyPayload {
  prototype: boolean;
  banner: string;
  synthetic_data: { cnic_prefix: string; note: string };
  ai_provider: string;
  demo_mode: boolean;
  components: {
    component: string;
    name_ur: string;
    status: TransparencyStatus;
    details: string;
  }[];
  /** Live chaos mode of each simulated DPI service (`mock_service_statuses`). */
  mock_services: {
    service_name: string;
    mode: string;
    latency_ms: number;
    failure_rate: number;
    updated_at: string | null;
  }[];
  mock_services_note: string;
}

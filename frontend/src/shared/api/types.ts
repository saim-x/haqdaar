// DTOs mirroring docs/04-data-model.md and docs/05-api-contracts.md.
// Do not add fields that are not in those documents.

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
export type DocType = 'CNIC_FRONT' | 'SPOUSE_DEATH_CERTIFICATE' | 'OTHER';
export type DocVerifyStatus = 'PENDING' | 'VERIFIED' | 'NEEDS_RETAKE' | 'UNVERIFIABLE' | 'TAMPER_SUSPECTED';
export type ConsentRecipientType = 'DEPARTMENT' | 'HELPER';
export type ConsentStatus = 'ACTIVE' | 'WITHDRAWN' | 'EXPIRED';
export type DataCategory = 'IDENTITY' | 'HOUSEHOLD' | 'DOCUMENTS' | 'PAYMENT' | 'CASE_HISTORY';
export type ConsentPurpose =
  | 'BENEFIT_APPLICATION'
  | 'PAYMENT_DISBURSEMENT'
  | 'HELPER_ASSISTANCE'
  | 'COMPLAINT_RESOLUTION';
export type AssuranceLevel = 'SELF_OTP' | 'CITIZEN_OTP' | 'VERBAL_WITNESSED';
export type ScamVerdict = 'VERIFIED_OFFICIAL' | 'LIKELY_SAFE' | 'CANNOT_TELL' | 'LIKELY_SCAM';
export type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED_RETRY' | 'DEAD';
export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';
export type PriorityBand = 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW';
export type MockMode = 'NORMAL' | 'SLOW' | 'FLAKY' | 'DOWN';
export type RuleStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export type PersonaKey =
  | 'widow_fatima'
  | 'shopkeeper_rasool'
  | 'helper_ayesha'
  | 'officer_sana'
  | 'officer_imran'
  | 'admin_bilal'
  | 'admin_platform'
  | 'auditor_nadia'
  | 'officer_zakat';

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message_en: string;
    message_ur: string;
    request_id?: string;
    details?: Record<string, unknown>;
  };
}

// ---------- Auth ----------
export interface User {
  id: string;
  role: Role;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  tenant_id?: string | null;
  preferred_lang?: 'ur' | 'en';
  is_active?: boolean;
  created_at?: string;
}

export interface Tenant {
  id: string;
  code: string;
  name: string;
  name_ur: string;
}

export interface Citizen {
  id: string;
  full_name: string;
  cnic_masked?: string | null;
  phone?: string | null;
  district?: string | null;
  dob?: string | null;
  avatar_color: string;
}

export interface TokenPayload {
  access_token: string;
  refresh_token: string;
  user: User;
  citizen_id?: string | null;
}

export interface MeResponse {
  user: User;
  citizen: Citizen | null;
  tenant: Tenant | null;
}

export interface OtpRequestResponse {
  challenge_id: string;
  expires_in_sec: number;
  simulated_sms_hint: string;
}

// ---------- Programs ----------
export interface Program {
  id: string;
  code: string;
  name: string;
  name_ur: string;
  description: string;
  description_ur: string;
  required_documents: DocType[];
  wizard_schema?: unknown;
  tenant_id?: string;
  active_rule_version_id?: string | null;
}

// ---------- Cases ----------
export type MissingReason = 'USER_UNKNOWN' | 'NOT_WITH_ME' | null;

export interface DraftAnswer {
  value: string | number | boolean | null;
  confirmed: boolean;
  entered_by?: 'CITIZEN' | 'HELPER' | 'SYSTEM';
  missing_reason?: MissingReason;
}

export type DraftAnswers = Record<string, DraftAnswer>;

export interface Explanation {
  headline_ur: string;
  headline_en: string;
  reasons_ur: string[];
  reasons_en: string[];
  next_step_ur: string;
  next_step_en: string;
}

export interface TimelineItem {
  at: string;
  label_ur: string;
  label_en: string;
}

export interface CaseDocument {
  id: string;
  doc_type: DocType;
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
  value?: number | string | null;
  threshold?: number | string | null;
  detail?: string;
}

export interface Payment {
  status: 'CREATED' | 'INITIATED' | 'COMPLETED' | 'FAILED';
  amount_pkr: number;
  external_ref?: string | null;
  failure_reason?: string | null;
}

export interface ProgramRef {
  id?: string;
  code: string;
  name: string;
  name_ur: string;
}

export interface Flag {
  code: string;
  severity: Severity;
  detail?: string;
}

export interface AiCaseNote {
  verified: string[];
  uncertain: string[];
  suggested_checks: string[];
  summary_en?: string;
  summary_ur?: string;
}

export interface FactValue {
  state: 'KNOWN' | 'UNKNOWN';
  value: unknown;
  source: string | null;
  source_confidence: number;
  entered_by: string;
  alternatives: { value: unknown; source: string; entered_by?: string }[];
  conflict: boolean;
  missing_reason: string | null;
}

export interface RuleTraceItem {
  rule_id: string;
  result: 'PASS' | 'FAIL' | 'UNKNOWN';
  actual: unknown;
  expected: unknown;
  reason_ur: string;
  reason_en: string;
  label_en?: string;
}

export interface ConfidenceComponents {
  identity: number;
  documents: number;
  data_consistency: number;
  consent_assurance: number;
  overall: number;
}

export interface AgentStep {
  at: string;
  tool: string;
  status: 'OK' | 'FAILED' | 'RETRIED' | 'SKIPPED';
  duration_ms: number;
  summary: string;
}

export interface CaseNote {
  id: string;
  note_type: 'AGENT_STEP' | 'AI_HANDOFF' | 'OFFICER_NOTE' | 'CITIZEN_REPLY';
  body: string;
  author_label?: string | null;
  is_visible_to_citizen: boolean;
  created_at: string;
}

export interface CaseSummary {
  id: string;
  reference_code: string;
  program: ProgramRef;
  case_type: CaseType;
  status: CaseStatus;
  approved_amount_pkr?: number | null;
  updated_at?: string;
  created_at?: string;
}

export interface CaseDetail extends CaseSummary {
  wizard_step?: string | null;
  draft_answers: DraftAnswers;
  documents: CaseDocument[];
  citizen_explanation?: Explanation | null;
  payment?: Payment | null;
  timeline: TimelineItem[];
  parent_case_id?: string | null;
  submitted_via_helper?: boolean;
  // Officer / auditor view only
  citizen?: Citizen;
  facts?: Record<string, FactValue>;
  rule_trace?: RuleTraceItem[];
  flags?: Flag[];
  ai_case_note?: AiCaseNote | null;
  confidence_components?: ConfidenceComponents | null;
  latest_confidence?: number | null;
  latest_route?: RouteAction | null;
  priority_band?: PriorityBand;
  priority_score?: number;
  assigned_officer?: { id: string; full_name: string } | null;
  first_approver?: { id: string; full_name: string } | null;
  rule_version?: { id: string; version_number: number; content_hash: string } | null;
  active_rule_version?: { id: string; version_number: number; content_hash: string } | null;
  agent_steps?: AgentStep[];
  notes?: CaseNote[];
  ask_more_rounds?: number;
}

// ---------- Officer ----------
export interface QueueCard {
  id: string;
  reference_code: string;
  applicant_name: string;
  cnic_masked: string;
  status: CaseStatus;
  priority_band: PriorityBand;
  priority_score: number;
  latest_confidence: number | null;
  latest_route: RouteAction | null;
  reason_codes: string[];
  flags: Flag[];
  submitted_at: string;
  assigned_officer?: { id: string; full_name: string } | null;
  rule_stale: boolean;
  rule_version_number?: number;
  ai_recommendation?: string;
}

export type DecideAction = 'APPROVE' | 'REJECT' | 'REQUEST_INFO' | 'ESCALATE';

export interface DecideRequest {
  action: DecideAction;
  reason_codes: string[];
  note: string;
  requested_fields?: string[];
  override_amount_pkr?: number | null;
}

// ---------- Documents ----------
export interface DocumentUploadResponse extends CaseDocument {
  case_id?: string | null;
}

// ---------- Consent ----------
export interface ConsentGrant {
  id: string;
  citizen_id: string;
  recipient_type: ConsentRecipientType;
  recipient_label: string;
  recipient_tenant_id?: string | null;
  recipient_user_id?: string | null;
  categories: DataCategory[];
  purposes: ConsentPurpose[];
  status: ConsentStatus;
  assurance_level: AssuranceLevel;
  granted_at: string;
  expires_at?: string | null;
  withdrawn_at?: string | null;
}

export interface AccessLog {
  id: string;
  actor_label: string;
  actor_role: Role;
  category: DataCategory;
  purpose: ConsentPurpose;
  resource_ref: string;
  allowed: boolean;
  denial_reason?: string | null;
  created_at: string;
}

export interface MyDataField {
  key: string;
  label_en: string;
  label_ur: string;
  value: unknown;
  source_type: 'SELF_DECLARED' | 'REGISTRY';
  source_label?: string;
}

export interface MyDataResponse {
  groups: { category: DataCategory; fields: MyDataField[] }[];
  corrections: CorrectionRequest[];
}

export interface CorrectionRequest {
  id: string;
  citizen_name?: string;
  field_key: string;
  source_type: 'SELF_DECLARED' | 'REGISTRY';
  old_value: unknown;
  requested_value: unknown;
  reason?: string | null;
  status: 'APPLIED' | 'PENDING_OFFICER' | 'APPROVED' | 'REJECTED';
  created_at: string;
}

export interface Notification {
  id: string;
  channel: 'IN_APP' | 'SMS_SIMULATED';
  title_ur: string;
  title_en: string;
  body_ur: string;
  body_en: string;
  verification_code: string;
  case_id?: string | null;
  read_at?: string | null;
  created_at: string;
}

// ---------- Helper ----------
export interface Family {
  citizen_id: string;
  full_name: string;
  full_name_ur?: string;
  cnic_masked: string | null;
  avatar_color: string;
  district?: string | null;
  active_case_count: number;
  consent_status: ConsentStatus;
  consent_expires_at?: string | null;
  assurance_level?: AssuranceLevel;
}

// ---------- AI ----------
export interface VoiceParseResponse {
  transcript: string;
  parsed_value: string | number | null;
  confidence: number;
  readback_ur: string;
  readback_en: string;
  needs_retry: boolean;
  missing_reason?: MissingReason;
}

export interface RedFlag {
  code: string;
  label_en: string;
  label_ur: string;
}

export interface ScamCheckResponse {
  check_id: string;
  verdict: ScamVerdict;
  confidence: number;
  red_flags: RedFlag[];
  matched_official: { verification_code: string; program?: string; sent_at: string } | null;
  explanation_ur: string;
  explanation_en: string;
  advice_ur: string;
  advice_en: string;
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
}

// ---------- Rules ----------
export type RuleOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in';
export type RuleOutcome = 'HUMAN' | 'ASK';

export interface EligibilityRule {
  id: string;
  fact: string;
  op: RuleOp;
  value: unknown;
  on_fail: RuleOutcome;
  on_unknown: RuleOutcome;
  required_for_auto: boolean;
  label_en: string;
  label_ur: string;
  pass_reason_en: string;
  pass_reason_ur: string;
  fail_reason_en: string;
  fail_reason_ur: string;
  ask_prompt_en: string | null;
  ask_prompt_ur: string | null;
}

export interface RuleSet {
  schema_version: string;
  program_code: string;
  policy: {
    auto_approve_confidence_threshold: number;
    auto_approve_max_amount_pkr: number;
    max_ask_more_rounds: number;
    cost_matrix: {
      wrong_approval_cost: number;
      unnecessary_human_review_cost: number;
      ask_more_cost: number;
      missed_fraud_multiplier: number;
    };
  };
  eligibility_rules: EligibilityRule[];
  benefit_formula: {
    base_amount_pkr: number;
    per_child_bonus_pkr: number;
    max_children_counted: number;
    hard_cap_pkr: number;
  };
}

export interface RuleVersion {
  id: string;
  program_id: string;
  version_number: number;
  status: RuleStatus;
  rules_json: RuleSet;
  content_hash: string;
  change_note: string | null;
  created_by?: string;
  published_by?: string | null;
  published_at: string | null;
  created_at: string;
}

export interface RuleValidationResult {
  valid: boolean;
  errors: { path: string; message: string }[];
}

export type TwinOutcome = 'APPROVED' | 'NEEDS_INFO' | 'HUMAN_REVIEW';

export interface TwinResult {
  simulation_id?: string;
  sample_size: number;
  before_counts: Record<TwinOutcome, number>;
  after_counts: Record<TwinOutcome, number>;
  flipped_count: number;
  flipped_cases: {
    case_id: string;
    reference_code: string;
    before_route: TwinOutcome;
    after_route: TwinOutcome;
    before_amount: number | null;
    after_amount: number | null;
    primary_reason: string;
  }[];
  budget_delta_pkr: number;
}

// ---------- Admin ----------
export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  rate_limit_per_min: number;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

export interface ApiKeyCreated extends ApiKey {
  api_key: string;
}

export interface MockServiceConfig {
  service_name: string;
  mode: MockMode;
  latency_ms: number;
  failure_rate: number;
  updated_at: string;
}

export interface Job {
  id: string;
  job_type: string;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_after: string;
  last_error: string | null;
  payload_json: Record<string, unknown>;
  created_at: string;
}

// ---------- Auditor ----------
export interface AuditEvent {
  seq: number;
  id: string;
  tenant_id: string | null;
  actor_type: 'USER' | 'AI' | 'AGENT' | 'SYSTEM' | 'API_KEY';
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  payload_json: Record<string, unknown>;
  prev_hash: string;
  event_hash: string;
  created_at: string;
}

export interface ChainVerifyResult {
  valid: boolean;
  checked_count: number;
  first_broken_seq: number | null;
}

export interface DecisionTrace {
  id: string;
  decision_source: 'AI_ENGINE' | 'OFFICER' | 'SECOND_OFFICER';
  actor_label?: string | null;
  rule_version_number: number;
  rule_content_hash: string;
  input_snapshot_json: Record<string, FactValue>;
  input_snapshot_hash: string;
  rule_trace_json: RuleTraceItem[];
  confidence_components: ConfidenceComponents;
  confidence_overall: number;
  route_action: RouteAction;
  outcome_status: CaseStatus;
  escalation_reasons: string[];
  model_versions: Record<string, string>;
  citizen_explanation: Explanation;
  computed_amount_pkr: number | null;
  officer_reason_codes?: string[] | null;
  officer_note?: string | null;
  is_override: boolean;
  created_at: string;
}

export interface CaseTrace {
  case_id: string;
  reference_code: string;
  decisions: DecisionTrace[];
  agent_steps: AgentStep[];
}

// ---------- Eval / Analytics ----------
export interface SweepPoint {
  threshold: number;
  auto_approve_rate: number;
  false_approval_rate: number;
  human_review_load: number;
  expected_total_cost: number;
}

export interface EvalDashboard {
  threshold_sweep: { active_threshold: number; sample_size: number; points: SweepPoint[] };
  scam: {
    precision: number;
    recall: number;
    f1: number;
    confusion_matrix: { tp: number; fp: number; tn: number; fn: number };
    hard_negative_fpr: number;
    test_size: number;
    disputed_count: number;
  };
  documents: {
    sample_size: number;
    genuine_verified_rate: number;
    tamper_catch_rate: number;
    false_tamper_rate: number;
    blurry_retake_rate: number;
  };
  live: {
    route_distribution: Record<RouteAction, number>;
    officer_override_rate: number;
    pipeline_latency_ms: { p50: number; p95: number };
    llm: { calls: number; cost_usd: number; failure_rate: number; fallback_count: number };
  };
}

export interface TenantAnalytics {
  tenant: { code: string; name: string };
  cases_by_status: Partial<Record<CaseStatus, number>>;
  total_applications: number;
  auto_approve_pct: number;
  approval_rate: number;
  avg_time_to_decision_hours: number;
  disbursed_pkr: number;
  top_flags: { code: string; count: number }[];
}

export interface TransparencyItem {
  component: string;
  kind: 'REAL' | 'SIMULATED' | 'SYNTHETIC';
  details: string;
}

export interface TransparencyResponse {
  items: TransparencyItem[];
  mock_services: { service_name: string; mode: MockMode }[];
}

export interface SmsMessage {
  id: string;
  kind: 'OTP' | 'NOTIFICATION';
  body_ur: string;
  body_en: string;
  verification_code?: string | null;
  created_at: string;
}

export interface SmsInbox {
  simulated: true;
  phone: string;
  messages: SmsMessage[];
}

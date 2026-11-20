import type {
  AccessLog,
  AgentStep,
  AiCaseNote,
  ApiKey,
  AuditEvent,
  CaseNote,
  CaseStatus,
  CaseType,
  ConfidenceComponents,
  ConsentGrant,
  CorrectionRequest,
  DocType,
  DocVerifyStatus,
  DraftAnswers,
  Explanation,
  Flag,
  Job,
  MockServiceConfig,
  Notification,
  Payment,
  PriorityBand,
  Program,
  Role,
  RouteAction,
  RuleTraceItem,
  RuleVersion,
  Tenant,
  TimelineItem,
  VerifyCheck,
} from '../api/types';
import { amountFor, evaluate, known, overallConfidence, route, type Facts, type HistoricalCase } from './engine';
import { GUZARA_V1, SAHARA_V1, SINDH_DISTRICTS } from './rules';
import { canonical, minutesAgo, rng, sha256 } from './util';

// ---------- internal row types (superset of the API DTOs) ----------
export interface MUser {
  id: string;
  role: Role;
  full_name: string;
  email: string | null;
  phone: string | null;
  tenant_id: string | null;
  is_active: boolean;
  persona_key?: string;
  created_at: string;
}

export interface MCitizen {
  id: string;
  user_id: string | null;
  full_name: string;
  full_name_ur?: string;
  cnic_digits: string | null;
  phone: string | null;
  district: string | null;
  dob: string | null;
  avatar_color: string;
  profile: Record<string, unknown>;
  created_by_user_id: string | null;
}

export interface MDocument {
  id: string;
  tenant_id: string;
  citizen_id: string;
  case_id: string | null;
  doc_type: DocType;
  verify_status: DocVerifyStatus;
  verify_confidence: number | null;
  verify_checks: VerifyCheck[];
  extracted_fields: Record<string, unknown>;
  retake_reason_ur: string | null;
  retake_reason_en: string | null;
  data_url?: string;
  created_at: string;
}

export interface MCase {
  id: string;
  reference_code: string;
  tenant_id: string;
  program_id: string;
  citizen_id: string;
  submitted_by_user_id: string;
  submitted_via_helper: boolean;
  case_type: CaseType;
  parent_case_id: string | null;
  status: CaseStatus;
  previous_status: CaseStatus | null;
  assigned_officer_id: string | null;
  first_approver_id: string | null;
  priority_score: number;
  priority_band: PriorityBand;
  latest_confidence: number | null;
  latest_route: RouteAction | null;
  latest_rule_version_id: string | null;
  approved_amount_pkr: number | null;
  ask_more_rounds: number;
  wizard_step: string | null;
  draft_answers: DraftAnswers;
  flags: Flag[];
  ai_case_note: AiCaseNote | null;
  citizen_explanation: Explanation | null;
  facts: Facts;
  rule_trace: RuleTraceItem[];
  confidence: ConfidenceComponents | null;
  timeline: TimelineItem[];
  agent_steps: AgentStep[];
  notes: CaseNote[];
  payment: (Payment & { payout_alias: string }) | null;
  submitted_at: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MDecision {
  id: string;
  tenant_id: string;
  case_id: string;
  decision_source: 'AI_ENGINE' | 'OFFICER' | 'SECOND_OFFICER';
  actor_user_id: string | null;
  rule_version_id: string;
  rule_content_hash: string;
  rule_version_number: number;
  input_snapshot_json: Facts;
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
  officer_reason_codes: string[] | null;
  officer_note: string | null;
  is_override: boolean;
  created_at: string;
}

export interface MNotification extends Notification {
  tenant_id: string | null;
  citizen_id: string | null;
  phone: string | null;
  body_sha256: string;
}

export interface MOtp {
  id: string;
  phone: string;
  code: string;
  purpose: 'LOGIN' | 'HELPER_CONSENT';
  citizen_id?: string;
  created_at: string;
  consumed: boolean;
}

export interface MScamCheck {
  id: string;
  verdict: string;
  disputed: boolean;
  created_at: string;
}

export interface RegistryPerson {
  cnic: string;
  full_name: string;
  full_name_ur: string;
  dob: string;
  district: string;
  is_alive: boolean;
  cnic_expiry: string;
  spouse_name?: string;
}

export interface MockState {
  version: number;
  seq: number;
  tenants: Tenant[];
  programs: Program[];
  ruleVersions: RuleVersion[];
  users: MUser[];
  citizens: MCitizen[];
  cases: MCase[];
  documents: MDocument[];
  decisions: MDecision[];
  grants: ConsentGrant[];
  accessLogs: (AccessLog & { citizen_id: string; tenant_id: string | null })[];
  notifications: MNotification[];
  otps: MOtp[];
  audit: AuditEvent[];
  mockServices: MockServiceConfig[];
  jobs: Job[];
  apiKeys: ApiKey[];
  scamChecks: MScamCheck[];
  corrections: (CorrectionRequest & { citizen_id: string })[];
  history: HistoricalCase[];
  registry: RegistryPerson[];
  deaths: { deceased_name: string; deceased_cnic: string; spouse_cnic: string; spouse_name: string; district: string; death_date: string }[];
  households: { head_cnic: string; income: number; size: number; poverty: number }[];
  benefits: { cnic: string; program: string }[];
  refCounter: number;
}

export const STATE_VERSION = 4;

const T_SPD = 'tenant-spd';
const T_ZWB = 'tenant-zwb';
export const P_SAHARA = 'program-sahara';
export const P_GUZARA = 'program-guzara';

export function hashRules(rules: unknown) {
  return sha256(canonical(rules));
}

const fam = (
  id: string,
  name: string,
  nameUr: string,
  cnic: string,
  district: string,
  color: string,
  phone: string | null,
  dob = '1980-01-01',
): MCitizen => ({
  id,
  user_id: null,
  full_name: name,
  full_name_ur: nameUr,
  cnic_digits: cnic,
  phone,
  district,
  dob,
  avatar_color: color,
  profile: {},
  created_by_user_id: 'user-ayesha',
});

function baseCase(p: Partial<MCase> & Pick<MCase, 'id' | 'reference_code' | 'citizen_id' | 'status'>): MCase {
  const t = minutesAgo(600);
  return {
    tenant_id: T_SPD,
    program_id: P_SAHARA,
    submitted_by_user_id: 'user-fatima',
    submitted_via_helper: false,
    case_type: 'BENEFIT_APPLICATION',
    parent_case_id: null,
    previous_status: null,
    assigned_officer_id: null,
    first_approver_id: null,
    priority_score: 30,
    priority_band: 'NORMAL',
    latest_confidence: null,
    latest_route: null,
    latest_rule_version_id: 'rv-sahara-1',
    approved_amount_pkr: null,
    ask_more_rounds: 0,
    wizard_step: 'review',
    draft_answers: {},
    flags: [],
    ai_case_note: null,
    citizen_explanation: null,
    facts: {},
    rule_trace: [],
    confidence: null,
    timeline: [],
    agent_steps: [],
    notes: [],
    payment: null,
    submitted_at: t,
    decided_at: null,
    created_at: t,
    updated_at: t,
    ...p,
  };
}

function cleanFacts(over: Partial<Record<string, unknown>> = {}, sources: Record<string, string> = {}): Facts {
  const v: Record<string, unknown> = {
    applicant_cnic: '9990010001012',
    applicant_full_name: 'Applicant',
    applicant_age_years: 44,
    applicant_is_alive: true,
    applicant_cnic_valid: true,
    applicant_district: 'Thatta',
    spouse_death_verified: true,
    children_under_18: 2,
    household_size: 5,
    monthly_income_pkr: 26000,
    has_conflicting_active_grant: false,
    payout_phone: '+923001110000',
    cnic_doc_verified: true,
    citizen_has_active_dept_consent: true,
    ...over,
  };
  const defaultSource: Record<string, string> = {
    applicant_cnic: 'DOCUMENT_QR',
    applicant_full_name: 'IDENTITY_REGISTRY',
    applicant_age_years: 'IDENTITY_REGISTRY',
    applicant_is_alive: 'IDENTITY_REGISTRY',
    applicant_cnic_valid: 'IDENTITY_REGISTRY',
    applicant_district: 'SELF_DECLARED',
    spouse_death_verified: 'CIVIL_REGISTRY',
    children_under_18: 'SELF_DECLARED',
    household_size: 'HOUSEHOLD_SURVEY',
    monthly_income_pkr: 'HOUSEHOLD_SURVEY',
    has_conflicting_active_grant: 'BENEFITS_REGISTRY',
    payout_phone: 'SELF_DECLARED',
    cnic_doc_verified: 'DOCUMENT_VERIFIER',
    citizen_has_active_dept_consent: 'CONSENT_ENGINE',
  };
  const out: Facts = {};
  for (const [k, val] of Object.entries(v)) {
    if (val === undefined) continue;
    out[k] = known(val, sources[k] ?? defaultSource[k] ?? 'SELF_DECLARED', 0.95, defaultSource[k] === 'SELF_DECLARED' ? 'CITIZEN' : 'SYSTEM');
  }
  return out;
}

function decided(c: MCase, conf: ConfidenceComponents, reasons: string[], note: AiCaseNote): MCase {
  const trace = evaluate(c.facts, SAHARA_V1);
  return {
    ...c,
    confidence: conf,
    latest_confidence: conf.overall,
    latest_route: 'HUMAN_REVIEW',
    rule_trace: trace,
    ai_case_note: note,
    citizen_explanation: {
      headline_ur: 'ایک افسر آپ کی درخواست دیکھے گا — عام طور پر 2 دن میں۔',
      headline_en: 'An officer will review your application — usually within 2 days.',
      reasons_ur: ['کچھ معلومات کی انسانی تصدیق ضروری ہے۔'],
      reasons_en: ['Some information needs to be checked by a person.'],
      next_step_ur: 'آپ کو کچھ کرنے کی ضرورت نہیں۔',
      next_step_en: 'You do not need to do anything.',
    },
    agent_steps: agentSteps(c.submitted_at ?? c.created_at, reasons),
    timeline: [
      { at: c.submitted_at ?? c.created_at, label_en: 'Application submitted', label_ur: 'درخواست جمع ہوئی' },
      { at: c.submitted_at ?? c.created_at, label_en: 'Checking with government records', label_ur: 'سرکاری ریکارڈ سے جانچ' },
      { at: c.submitted_at ?? c.created_at, label_en: 'Sent to an officer for review', label_ur: 'افسر کو جائزے کے لیے بھیجا گیا' },
    ],
  };
}

export function agentSteps(at: string, reasons: string[] = []): AgentStep[] {
  const t0 = new Date(at).getTime();
  const steps: [string, number, string][] = [
    ['case.load', 12, 'Loaded case and confirmed draft answers'],
    ['identity.lookup', 64, 'Identity registry (simulated) queried by CNIC'],
    ['civil.death_records', 51, 'Civil registry (simulated) searched for spouse death record'],
    ['household.survey', 47, 'Household survey (simulated) fetched income and size'],
    ['benefits.active', 38, 'Benefits registry (simulated) checked for conflicting grants'],
    ['documents.results', 6, 'Collected document verification results'],
    ['anomalies.check', 9, reasons.length ? `Raised: ${reasons.join(', ')}` : 'No anomaly flags'],
    ['rules.evaluate', 3, 'Evaluated active rule set'],
    ['router.route', 1, 'Routed with weakest-link confidence and cost matrix'],
  ];
  let t = t0;
  return steps.map(([tool, ms, summary]) => {
    t += ms;
    return { at: new Date(t).toISOString(), tool, status: 'OK' as const, duration_ms: ms, summary };
  });
}

export function seed(): MockState {
  const now = new Date().toISOString();
  const rand = rng(20261120);

  const tenants: Tenant[] = [
    { id: T_SPD, code: 'SPD', name: 'Social Protection Department (Mock)', name_ur: 'محکمہ سماجی تحفظ (نقلی)' },
    { id: T_ZWB, code: 'ZWB', name: 'Zakat & Welfare Board (Mock)', name_ur: 'زکوٰۃ و بہبود بورڈ (نقلی)' },
  ];

  const programs: Program[] = [
    {
      id: P_SAHARA,
      tenant_id: T_SPD,
      code: 'SAHARA_WIDOW_GRANT',
      name: 'Sahara Widow Support Grant',
      name_ur: 'سہارا بیوہ امدادی گرانٹ',
      description: 'One-time support for widowed women in low-income Sindh households (fictional program).',
      description_ur: 'سندھ کے کم آمدنی والے گھروں کی بیوہ خواتین کے لیے ایک بار کی امداد (فرضی پروگرام)۔',
      required_documents: ['CNIC_FRONT', 'SPOUSE_DEATH_CERTIFICATE'],
      active_rule_version_id: 'rv-sahara-1',
    },
    {
      id: P_GUZARA,
      tenant_id: T_ZWB,
      code: 'GUZARA_ALLOWANCE',
      name: 'Guzara Allowance',
      name_ur: 'گزارہ الاؤنس',
      description: 'Monthly subsistence allowance for very poor households (fictional program).',
      description_ur: 'انتہائی غریب گھرانوں کے لیے ماہانہ گزارہ الاؤنس (فرضی پروگرام)۔',
      required_documents: ['CNIC_FRONT'],
      active_rule_version_id: 'rv-guzara-1',
    },
  ];

  const ruleVersions: RuleVersion[] = [
    {
      id: 'rv-sahara-1',
      program_id: P_SAHARA,
      version_number: 1,
      status: 'PUBLISHED',
      rules_json: SAHARA_V1,
      content_hash: hashRules(SAHARA_V1),
      change_note: 'Initial Sahara policy (income <= 40,000; base 12,000 + 1,000 per child; cap 20,000).',
      created_by: 'Bilal Ahmed',
      published_by: 'Bilal Ahmed',
      published_at: minutesAgo(60 * 24 * 7),
      created_at: minutesAgo(60 * 24 * 7),
    },
    {
      id: 'rv-guzara-1',
      program_id: P_GUZARA,
      version_number: 1,
      status: 'PUBLISHED',
      rules_json: GUZARA_V1,
      content_hash: hashRules(GUZARA_V1),
      change_note: 'Initial Guzara policy.',
      created_by: 'ZWB Admin',
      published_by: 'ZWB Admin',
      published_at: minutesAgo(60 * 24 * 7),
      created_at: minutesAgo(60 * 24 * 7),
    },
  ];

  const u = (id: string, role: Role, full_name: string, persona_key: string, extra: Partial<MUser> = {}): MUser => ({
    id,
    role,
    full_name,
    persona_key,
    email: null,
    phone: null,
    tenant_id: null,
    is_active: true,
    created_at: minutesAgo(60 * 24 * 30),
    ...extra,
  });
  const users: MUser[] = [
    u('user-fatima', 'CITIZEN', 'Fatima Bibi', 'widow_fatima', { phone: '+923001000001' }),
    u('user-rasool', 'CITIZEN', 'Rasool Bakhsh', 'shopkeeper_rasool', { phone: '+923001000002' }),
    u('user-ayesha', 'HELPER', 'Ayesha Khatoon', 'helper_ayesha', { email: 'ayesha@helper.mock', phone: '+923001000003' }),
    u('user-sana', 'OFFICER', 'Sana Qureshi', 'officer_sana', { email: 'sana@spd.mock', tenant_id: T_SPD }),
    u('user-imran', 'OFFICER', 'Imran Siddiqui', 'officer_imran', { email: 'imran@spd.mock', tenant_id: T_SPD }),
    u('user-bilal', 'ADMIN', 'Bilal Ahmed', 'admin_bilal', { email: 'bilal@spd.mock', tenant_id: T_SPD }),
    u('user-platform', 'ADMIN', 'Platform Admin', 'admin_platform', { email: 'platform@haqdaar.mock' }),
    u('user-nadia', 'AUDITOR', 'Nadia Farooq', 'auditor_nadia', { email: 'nadia@audit.mock' }),
    u('user-tariq', 'OFFICER', 'Tariq Mehmood', 'officer_zakat', { email: 'tariq@zwb.mock', tenant_id: T_ZWB }),
  ];

  const citizens: MCitizen[] = [
    {
      id: 'cit-fatima',
      user_id: 'user-fatima',
      full_name: 'Fatima Bibi',
      full_name_ur: 'فاطمہ بی بی',
      cnic_digits: '9990010000012',
      phone: '+923001000001',
      district: 'Thatta',
      dob: '1974-05-14',
      avatar_color: '#0F766E',
      profile: {},
      created_by_user_id: null,
    },
    {
      id: 'cit-rasool',
      user_id: 'user-rasool',
      full_name: 'Rasool Bakhsh',
      full_name_ur: 'رسول بخش',
      cnic_digits: '9990010000021',
      phone: '+923001000002',
      district: 'Hyderabad',
      dob: '1981-02-02',
      avatar_color: '#1D4ED8',
      profile: {},
      created_by_user_id: null,
    },
    fam('cit-f2', 'Zainab Khatoon', 'زینب خاتون', '9990010000042', 'Thatta', '#9333EA', '+923001000003', '1979-03-11'),
    fam('cit-f3', 'Sakina Bano', 'سکینہ بانو', '9990010000052', 'Thatta', '#B45309', '+923001000003', '1985-07-21'),
    fam('cit-f4', 'Hajra Bibi', 'ہاجرہ بی بی', '9990010000062', 'Thatta', '#BE123C', '+923001000003', '1969-11-02'),
    fam('cit-f5', 'Mariam Solangi', 'مریم سولنگی', '9990010000072', 'Badin', '#15803D', '+923001000003', '1988-01-30'),
    fam('cit-f6', 'Nasreen Mallah', 'نسرین ملاح', '9990010000082', 'Thatta', '#0369A1', '+923001000003', '1976-09-09'),
    fam('cit-f7', 'Rubina Jokhio', 'روبینہ جوکھیو', '9990010000092', 'Thatta', '#7C2D12', '+923001000003', '1983-04-18'),
    fam('cit-f8', 'Amina Khaskheli', 'آمنہ خاسخیلی', '9990010000102', 'Thatta', '#4338CA', null, '1972-12-25'),
  ];

  // Queue showcase citizens (docs/10 §2).
  const q = (id: string, name: string, cnic: string, district: string): MCitizen => ({
    id,
    user_id: null,
    full_name: name,
    cnic_digits: cnic,
    phone: null,
    district,
    dob: '1980-01-01',
    avatar_color: '#475569',
    profile: {},
    created_by_user_id: null,
  });
  citizens.push(
    q('cit-q101', 'Fatima Bibi (doc copy)', '9990010001012', 'Thatta'),
    q('cit-q102', 'Shazia Parveen', '9990010001022', 'Hyderabad'),
    q('cit-q103', 'Muhammad Akram (no CNIC)', '', 'Badin'),
    q('cit-q104', 'Kulsoom Bibi', '9990010001042', 'Karachi'),
    q('cit-q105', 'Sakina Bano', '9990010000052', 'Thatta'),
    q('cit-q106', 'Naseem Akhtar', '9990010001062', 'Dadu'),
  );

  const cases: MCase[] = [];
  const h = (mins: number) => minutesAgo(mins);

  // 101 — forged name vs signed QR → four-eyes
  {
    const facts = cleanFacts({ applicant_full_name: 'Fatima Bibi', applicant_cnic: '9990010001012', children_under_18: 3, monthly_income_pkr: 24000, cnic_doc_verified: false });
    facts.applicant_full_name.alternatives = [{ value: 'Zainab Bibi', source: 'DOCUMENT_OCR' }];
    facts.applicant_full_name.conflict = true;
    const flags: Flag[] = [{ code: 'TAMPER_SUSPECTED', severity: 'HIGH', detail: 'Printed name "Zainab Bibi" does not match signed QR name "Fatima Bibi" (QR signature valid).' }];
    cases.push(
      decided(
        baseCase({ id: 'case-101', reference_code: 'HQ-2026-000101', citizen_id: 'cit-q101', status: 'HUMAN_REVIEW', facts, flags, priority_score: 92, priority_band: 'URGENT', submitted_at: h(300), created_at: h(320) }),
        overallConfidence({ identity: 0.93, documents: 0.1, data_consistency: 0.2, consent_assurance: 1 }),
        ['TAMPER_SUSPECTED'],
        {
          verified: ['CNIC 99900-****101-2 exists in identity registry (name similarity 0.91 to QR name)', 'Spouse death confirmed by civil registry', 'Income PKR 24,000 from household survey (within limit)'],
          uncertain: ['TAMPER_SUSPECTED: printed name differs from the signed QR payload', 'Lowest pillar: documents (0.10)'],
          suggested_checks: ['Compare printed name on CNIC image against signed QR payload', 'Call applicant on registered phone and confirm identity', 'Request an in-person CNIC check if mismatch is not explained'],
          summary_en: 'Signed QR is valid but printed name was edited. Identity otherwise consistent.',
          summary_ur: 'کیو آر کوڈ درست ہے مگر چھپا ہوا نام تبدیل شدہ لگتا ہے۔',
        },
      ),
    );
  }
  // 102 — income conflict
  {
    const facts = cleanFacts({ applicant_full_name: 'Shazia Parveen', applicant_cnic: '9990010001022', applicant_district: 'Hyderabad', monthly_income_pkr: 54000, children_under_18: 2 });
    facts.monthly_income_pkr.alternatives = [{ value: 24000, source: 'SELF_DECLARED', entered_by: 'CITIZEN' }];
    facts.monthly_income_pkr.conflict = true;
    const flags: Flag[] = [{ code: 'DATA_CONFLICT_INCOME', severity: 'MEDIUM', detail: 'Self-declared PKR 24,000 vs household survey PKR 54,000 (diff 125 %).' }];
    cases.push(
      decided(
        baseCase({ id: 'case-102', reference_code: 'HQ-2026-000102', citizen_id: 'cit-q102', status: 'HUMAN_REVIEW', facts, flags, priority_score: 66, priority_band: 'HIGH', submitted_at: h(240), created_at: h(250) }),
        overallConfidence({ identity: 0.98, documents: 0.96, data_consistency: 0.72, consent_assurance: 1 }),
        ['DATA_CONFLICT_INCOME', 'RULE_FAIL_R05_INCOME_CAP'],
        {
          verified: ['Identity exact match (0.98)', 'CNIC document verified (signed QR)', 'Spouse death confirmed by civil registry'],
          uncertain: ['DATA_CONFLICT_INCOME: survey PKR 54,000 vs self-declared PKR 24,000', 'R05_INCOME_CAP fails on survey value'],
          suggested_checks: ['Ask applicant about household income sources since survey year 2024', 'Check whether survey household includes earning members who moved out'],
          summary_en: 'Income conflict between survey and declaration; rule fails on survey value.',
          summary_ur: 'سروے اور بیان کردہ آمدنی میں فرق ہے۔',
        },
      ),
    );
  }
  // 103 — ambiguous identity without CNIC
  {
    const facts = cleanFacts({ applicant_full_name: 'Muhammad Akram', applicant_district: 'Badin' });
    facts.applicant_cnic = { ...facts.applicant_cnic, state: 'UNKNOWN', value: null, source: null, missing_reason: 'USER_UNKNOWN' };
    facts.applicant_full_name.alternatives = [
      { value: 'Muhammad Akram (DOB 1971-03-02)', source: 'IDENTITY_REGISTRY' },
      { value: 'Mohammad Akram (DOB 1984-08-19)', source: 'IDENTITY_REGISTRY' },
    ];
    const flags: Flag[] = [{ code: 'POSSIBLE_DUPLICATE_IDENTITY', severity: 'HIGH', detail: 'Two registry candidates match the canonical name "muhammad akram" in Badin; no CNIC to disambiguate.' }];
    cases.push(
      decided(
        baseCase({ id: 'case-103', reference_code: 'HQ-2026-000103', citizen_id: 'cit-q103', status: 'HUMAN_REVIEW', facts, flags, priority_score: 71, priority_band: 'HIGH', submitted_at: h(200), created_at: h(210) }),
        overallConfidence({ identity: 0.25, documents: 0.55, data_consistency: 0.2, consent_assurance: 1 }),
        ['POSSIBLE_DUPLICATE_IDENTITY'],
        {
          verified: ['District Badin is eligible'],
          uncertain: ['POSSIBLE_DUPLICATE_IDENTITY: 2 candidates, no CNIC (never picked silently)', 'Lowest pillar: identity (0.25)'],
          suggested_checks: ['Request a CNIC photo from the applicant', 'Compare DOB with both candidates before linking'],
          summary_en: 'Ambiguous identity; system refused to guess between two records.',
          summary_ur: 'شناخت مبہم ہے؛ نظام نے اندازہ نہیں لگایا۔',
        },
      ),
    );
  }
  // 104 — shared payout
  {
    const facts = cleanFacts({ applicant_full_name: 'Kulsoom Bibi', applicant_cnic: '9990010001042', applicant_district: 'Karachi', payout_phone: '+923117778888' });
    const flags: Flag[] = [{ code: 'PAYOUT_ACCOUNT_SHARED', severity: 'HIGH', detail: 'Payout alias +92311****888 used by 3 unrelated applicants in 30 days.' }];
    cases.push(
      decided(
        baseCase({ id: 'case-104', reference_code: 'HQ-2026-000104', citizen_id: 'cit-q104', status: 'HUMAN_REVIEW', facts, flags, priority_score: 68, priority_band: 'HIGH', submitted_at: h(150), created_at: h(160) }),
        overallConfidence({ identity: 0.98, documents: 0.95, data_consistency: 0.2, consent_assurance: 1 }),
        ['PAYOUT_ACCOUNT_SHARED'],
        {
          verified: ['Identity exact match (0.98)', 'All eligibility rules pass'],
          uncertain: ['PAYOUT_ACCOUNT_SHARED: same payout number on 3 unrelated cases'],
          suggested_checks: ['Ask applicant who owns the payout number', 'Review the other 2 linked cases together'],
          summary_en: 'Eligible on rules, but payout number shared across unrelated applicants.',
          summary_ur: 'ادائیگی نمبر کئی درخواستوں میں مشترک ہے۔',
        },
      ),
    );
  }
  // 105 — verbal consent via helper
  {
    const facts = cleanFacts({ applicant_full_name: 'Sakina Bano', applicant_cnic: '9990010000052', children_under_18: 4, monthly_income_pkr: 19000 });
    const flags: Flag[] = [{ code: 'LOW_ASSURANCE_CONSENT', severity: 'MEDIUM', detail: 'Helper Ayesha captured witnessed verbal consent (no citizen OTP).' }];
    cases.push(
      decided(
        baseCase({
          id: 'case-105',
          reference_code: 'HQ-2026-000105',
          citizen_id: 'cit-q105',
          status: 'HUMAN_REVIEW',
          facts,
          flags,
          submitted_by_user_id: 'user-ayesha',
          submitted_via_helper: true,
          priority_score: 55,
          priority_band: 'NORMAL',
          submitted_at: h(90),
          created_at: h(100),
        }),
        overallConfidence({ identity: 0.98, documents: 0.96, data_consistency: 0.72, consent_assurance: 0.82 }),
        ['LOW_CONFIDENCE', 'LOW_ASSURANCE_CONSENT'],
        {
          verified: ['Identity exact match (0.98)', 'All 8 eligibility rules pass', 'Amount PKR 16,000 within auto cap'],
          uncertain: ['LOW_ASSURANCE_CONSENT: verbal consent caps confidence at 0.82 < 0.90'],
          suggested_checks: ['Listen to the recorded consent clip', 'Call the citizen to confirm she wants Ayesha to apply for her'],
          summary_en: 'Clean case, but verbal consent means a person must confirm before money moves.',
          summary_ur: 'زبانی اجازت کی وجہ سے افسر کی تصدیق ضروری ہے۔',
        },
      ),
    );
  }
  // 106 — payment failed (dormant account)
  {
    const facts = cleanFacts({ applicant_full_name: 'Naseem Akhtar', applicant_cnic: '9990010001062', applicant_district: 'Dadu', payout_phone: '+923009999999', children_under_18: 1 });
    const c = baseCase({
      id: 'case-106',
      reference_code: 'HQ-2026-000106',
      citizen_id: 'cit-q106',
      status: 'PAYMENT_FAILED',
      facts,
      priority_score: 62,
      priority_band: 'HIGH',
      approved_amount_pkr: 13000,
      latest_route: 'AUTO_APPROVE',
      latest_confidence: 0.96,
      confidence: overallConfidence({ identity: 0.98, documents: 0.96, data_consistency: 0.98, consent_assurance: 1 }),
      rule_trace: evaluate(facts, SAHARA_V1),
      submitted_at: h(1440),
      created_at: h(1450),
      decided_at: h(1438),
      payment: { status: 'FAILED', amount_pkr: 13000, external_ref: null, failure_reason: 'ACCOUNT_DORMANT', payout_alias: '+923009999999' },
      timeline: [
        { at: h(1440), label_en: 'Application submitted', label_ur: 'درخواست جمع ہوئی' },
        { at: h(1438), label_en: 'Approved automatically', label_ur: 'خودکار طور پر منظور' },
        { at: h(1430), label_en: 'Payment failed: account dormant', label_ur: 'ادائیگی ناکام: اکاؤنٹ غیر فعال' },
      ],
    });
    c.agent_steps = agentSteps(c.submitted_at!);
    cases.push(c);
  }

  // A couple of ZWB cases to prove tenant isolation.
  for (let i = 0; i < 4; i++) {
    const facts = cleanFacts({ applicant_full_name: `ZWB Applicant ${i + 1}`, poverty_score: 20 + i * 4 });
    cases.push(
      baseCase({
        id: `case-zwb-${i}`,
        reference_code: `HQ-2026-00090${i}`,
        tenant_id: T_ZWB,
        program_id: P_GUZARA,
        citizen_id: 'cit-rasool',
        status: i % 2 ? 'PAID' : 'HUMAN_REVIEW',
        facts,
        latest_confidence: 0.9,
        approved_amount_pkr: i % 2 ? 9000 : null,
        priority_band: 'NORMAL',
        submitted_at: h(500 + i * 60),
        created_at: h(500 + i * 60),
      }),
    );
  }

  // 60 historical decided Sahara cases for the Digital Twin (spread incomes 15k–45k, children 0–5).
  const history: HistoricalCase[] = [];
  for (let i = 0; i < 60; i++) {
    const income = Math.round((15000 + rand() * 30000) / 500) * 500;
    const kids = Math.floor(rand() * 6);
    const facts = cleanFacts({
      applicant_full_name: `Historical applicant ${i + 1}`,
      applicant_district: SINDH_DISTRICTS[Math.floor(rand() * SINDH_DISTRICTS.length)],
      monthly_income_pkr: income,
      children_under_18: kids,
      household_size: kids + 2,
    });
    const roll = rand();
    const flags: Flag[] = roll < 0.07 ? [{ code: 'DATA_CONFLICT_INCOME', severity: 'MEDIUM' }] : roll < 0.11 ? [{ code: 'DUPLICATE_APPLICATION', severity: 'HIGH' }] : [];
    const conf = overallConfidence({
      identity: rand() < 0.12 ? 0.75 : rand() < 0.4 ? 0.93 : 0.98,
      documents: 0.92 + rand() * 0.06,
      data_consistency: flags.some((f) => f.severity === 'HIGH') ? 0.2 : flags.length ? 0.72 : 0.98,
      consent_assurance: rand() < 0.08 ? 0.82 : 1,
    });
    if (rand() < 0.06) facts.spouse_death_verified = { ...facts.spouse_death_verified, state: 'UNKNOWN', value: null, source: null };
    history.push({ case_id: `hist-${i}`, reference_code: `HQ-2026-${String(10 + i).padStart(6, '0')}`, facts, flags, confidence: conf, ask_more_rounds: 0 });
  }

  // Consent grants
  const grant = (id: string, citizen_id: string, type: 'DEPARTMENT' | 'HELPER', label: string, extra: Partial<ConsentGrant> = {}): ConsentGrant => ({
    id,
    citizen_id,
    recipient_type: type,
    recipient_label: label,
    recipient_tenant_id: type === 'DEPARTMENT' ? T_SPD : null,
    recipient_user_id: type === 'HELPER' ? 'user-ayesha' : null,
    categories: type === 'HELPER' ? ['IDENTITY', 'HOUSEHOLD', 'DOCUMENTS', 'CASE_HISTORY'] : ['IDENTITY', 'HOUSEHOLD', 'DOCUMENTS', 'PAYMENT', 'CASE_HISTORY'],
    purposes: type === 'HELPER' ? ['HELPER_ASSISTANCE', 'BENEFIT_APPLICATION'] : ['BENEFIT_APPLICATION', 'PAYMENT_DISBURSEMENT'],
    status: 'ACTIVE',
    assurance_level: type === 'HELPER' ? 'CITIZEN_OTP' : 'SELF_OTP',
    granted_at: minutesAgo(60 * 24 * 3),
    expires_at: type === 'HELPER' ? new Date(Date.now() + 87 * 864e5).toISOString() : null,
    withdrawn_at: null,
    ...extra,
  });
  const grants: ConsentGrant[] = [
    grant('grant-fatima-ayesha', 'cit-fatima', 'HELPER', 'Helper Ayesha Khatoon'),
    ...['cit-f2', 'cit-f3', 'cit-f4', 'cit-f5', 'cit-f6', 'cit-f7'].map((c, i) =>
      grant(`grant-${c}-ayesha`, c, 'HELPER', 'Helper Ayesha Khatoon', i === 1 ? { assurance_level: 'VERBAL_WITNESSED' } : {}),
    ),
    grant('grant-f8-ayesha', 'cit-f8', 'HELPER', 'Helper Ayesha Khatoon', { status: 'EXPIRED', expires_at: minutesAgo(60 * 24) }),
    ...['cit-q101', 'cit-q102', 'cit-q103', 'cit-q104', 'cit-q105', 'cit-q106'].map((c) => grant(`grant-${c}-spd`, c, 'DEPARTMENT', 'Social Protection Dept (Mock)')),
  ];

  const mockServices: MockServiceConfig[] = ['identity', 'civil', 'household', 'benefits', 'payment', 'complaint', 'sms'].map((s) => ({
    service_name: s,
    mode: 'NORMAL',
    latency_ms: 4000,
    failure_rate: 0.5,
    updated_at: now,
  }));

  const registry: RegistryPerson[] = [
    { cnic: '9990010000012', full_name: 'Mst. Fatima Bibi', full_name_ur: 'مسماۃ فاطمہ بی بی', dob: '1974-05-14', district: 'Thatta', is_alive: true, cnic_expiry: '2031-05-14', spouse_name: 'Ghulam Rasool' },
    { cnic: '9990010000021', full_name: 'Rasool Bakhsh', full_name_ur: 'رسول بخش', dob: '1981-02-02', district: 'Hyderabad', is_alive: true, cnic_expiry: '2030-02-02' },
    ...citizens
      .filter((c) => c.id.startsWith('cit-f') && c.cnic_digits)
      .map((c) => ({ cnic: c.cnic_digits!, full_name: c.full_name, full_name_ur: c.full_name_ur ?? c.full_name, dob: c.dob ?? '1980-01-01', district: c.district ?? 'Thatta', is_alive: true, cnic_expiry: '2030-01-01' })),
  ];

  const st: MockState = {
    version: STATE_VERSION,
    seq: 0,
    tenants,
    programs,
    ruleVersions,
    users,
    citizens,
    cases,
    documents: [
      {
        id: 'doc-101-cnic',
        tenant_id: T_SPD,
        citizen_id: 'cit-q101',
        case_id: 'case-101',
        doc_type: 'CNIC_FRONT',
        verify_status: 'TAMPER_SUSPECTED',
        verify_confidence: 0.1,
        verify_checks: [
          { check: 'blur_laplacian_variance', passed: true, value: 212, threshold: 60, detail: 'Sharp image' },
          { check: 'qr_signature_hmac', passed: true, value: 'valid', threshold: 'HMAC-SHA256', detail: 'Signed by MOCK_IDENTITY_REGISTRY' },
          { check: 'ocr_vs_qr_name', passed: false, value: 0.41, threshold: 0.85, detail: 'Printed "Zainab Bibi" vs QR "Fatima Bibi"' },
          { check: 'ocr_vs_qr_cnic', passed: true, value: 1, threshold: 1, detail: 'CNIC digits match' },
        ],
        extracted_fields: { qr_payload: { full_name: 'Fatima Bibi', cnic: '9990010001012' }, ocr_fields: { full_name: 'Zainab Bibi' } },
        retake_reason_ur: null,
        retake_reason_en: null,
        created_at: minutesAgo(310),
      },
    ],
    decisions: [],
    grants,
    accessLogs: [],
    notifications: [],
    otps: [],
    audit: [],
    mockServices,
    jobs: [],
    apiKeys: [
      { id: 'key-1', name: 'District dashboard (read-only)', key_prefix: 'hq_live_7f3a91c2', scopes: ['cases:read', 'rules:read'], rate_limit_per_min: 60, is_active: true, last_used_at: minutesAgo(35), created_at: minutesAgo(60 * 24 * 2) },
    ],
    scamChecks: [],
    corrections: [],
    history,
    registry,
    deaths: [{ deceased_name: 'Ghulam Rasool', deceased_cnic: '9990010000039', spouse_cnic: '9990010000012', spouse_name: 'Fatima Bibi', district: 'Thatta', death_date: '2025-03-02' }],
    households: [
      { head_cnic: '9990010000012', income: 28000, size: 5, poverty: 22 },
      { head_cnic: '9990010000021', income: 65000, size: 6, poverty: 48 },
    ],
    benefits: [],
    refCounter: 142,
  };

  // Seed decisions for the queue cases so the auditor trace is complete.
  for (const c of st.cases.filter((x) => x.tenant_id === T_SPD && x.confidence)) {
    const rv = st.ruleVersions[0];
    const amount = amountFor(c.facts, rv.rules_json);
    const d = route(evaluate(c.facts, rv.rules_json), c.confidence!, c.flags, amount, rv.rules_json, 0, false);
    st.decisions.push({
      id: `dec-${c.id}`,
      tenant_id: c.tenant_id,
      case_id: c.id,
      decision_source: 'AI_ENGINE',
      actor_user_id: null,
      rule_version_id: rv.id,
      rule_content_hash: rv.content_hash,
      rule_version_number: 1,
      input_snapshot_json: c.facts,
      input_snapshot_hash: sha256(canonical(c.facts)),
      rule_trace_json: c.rule_trace,
      confidence_components: c.confidence!,
      confidence_overall: c.confidence!.overall,
      route_action: c.status === 'PAYMENT_FAILED' ? 'AUTO_APPROVE' : d.action,
      outcome_status: c.status === 'PAYMENT_FAILED' ? 'APPROVED' : 'HUMAN_REVIEW',
      escalation_reasons: c.status === 'PAYMENT_FAILED' ? [] : d.reasons,
      model_versions: { engine: '1.0.0', doc_verify: 'cv-1.2', scam: 'tfidf-lr-1.0', explainer: 'template-1.0' },
      citizen_explanation: c.citizen_explanation ?? {
        headline_ur: '',
        headline_en: '',
        reasons_ur: [],
        reasons_en: [],
        next_step_ur: '',
        next_step_en: '',
      },
      computed_amount_pkr: amount,
      officer_reason_codes: null,
      officer_note: null,
      is_override: false,
      created_at: c.submitted_at ?? c.created_at,
    });
  }
  return st;
}

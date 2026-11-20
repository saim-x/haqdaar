/**
 * SCAFFOLDING ONLY — `VITE_USE_MOCK_API=true`.
 *
 * Lets screens be built against the frozen contract (docs/05) before the backend
 * lands. It is a localStorage fixture layer, never a source of truth: every P0
 * flow must be re-verified against the real backend before the C2 checkpoint.
 * No `if (demo)` branches exist in feature code — determinism comes from seed data.
 */
import type { RequestOptions, ApiResponse } from './client';
import { ApiError } from './errors';
import type {
  CaseView,
  ConsentAccessLog,
  ConsentGrant,
  HelperFamily,
  LoginResponse,
  MeResponse,
  Program,
  AuditEvent,
  QueueItem,
  RuleVersion,
  ScamCheckResult,
  User,
} from './types';
import { uuid } from '../lib/uuid';

const STORE_KEY = 'haqdaar.mockapi.v1';

interface MockDb {
  cases: CaseView[];
  grants: ConsentGrant[];
  accessLogs: ConsentAccessLog[];
  families: HelperFamily[];
  rules: RuleVersion[];
  auditEvents: AuditEvent[];
  sms: Record<string, { id: string; body: string; code: string; created_at: string }[]>;
}

const PERSONAS: Record<string, { user: User; citizenId: string | null }> = {
  widow_fatima: {
    user: {
      id: 'u-fatima',
      role: 'CITIZEN',
      email: null,
      phone: '+923001000001',
      full_name: 'Fatima Bibi',
      preferred_lang: 'ur',
      tenant_id: null,
      is_active: true,
    },
    citizenId: 'c-fatima',
  },
  shopkeeper_rasool: {
    user: {
      id: 'u-rasool',
      role: 'CITIZEN',
      email: null,
      phone: '+923001000002',
      full_name: 'Rasool Bakhsh',
      preferred_lang: 'ur',
      tenant_id: null,
      is_active: true,
    },
    citizenId: 'c-rasool',
  },
  helper_ayesha: {
    user: {
      id: 'u-ayesha',
      role: 'HELPER',
      email: 'ayesha@helper.mock',
      phone: '+923001000003',
      full_name: 'Ayesha Khatoon',
      preferred_lang: 'ur',
      tenant_id: null,
      is_active: true,
    },
    citizenId: null,
  },
  officer_sana: {
    user: {
      id: 'u-sana',
      role: 'OFFICER',
      email: 'sana@spd.mock',
      phone: null,
      full_name: 'Sana Qureshi',
      preferred_lang: 'en',
      tenant_id: 't-spd',
      is_active: true,
    },
    citizenId: null,
  },
  officer_imran: {
    user: {
      id: 'u-imran',
      role: 'OFFICER',
      email: 'imran@spd.mock',
      phone: null,
      full_name: 'Imran Siddiqui',
      preferred_lang: 'en',
      tenant_id: 't-spd',
      is_active: true,
    },
    citizenId: null,
  },
  admin_bilal: {
    user: {
      id: 'u-bilal',
      role: 'ADMIN',
      email: 'bilal@spd.mock',
      phone: null,
      full_name: 'Bilal Ahmed',
      preferred_lang: 'en',
      tenant_id: 't-spd',
      is_active: true,
    },
    citizenId: null,
  },
  admin_platform: {
    user: {
      id: 'u-platform',
      role: 'ADMIN',
      email: 'platform@haqdaar.mock',
      phone: null,
      full_name: 'Platform Admin',
      preferred_lang: 'en',
      tenant_id: null,
      is_active: true,
    },
    citizenId: null,
  },
  auditor_nadia: {
    user: {
      id: 'u-nadia',
      role: 'AUDITOR',
      email: 'nadia@audit.mock',
      phone: null,
      full_name: 'Nadia Farooq',
      preferred_lang: 'en',
      tenant_id: null,
      is_active: true,
    },
    citizenId: null,
  },
  officer_zakat: {
    user: {
      id: 'u-tariq',
      role: 'OFFICER',
      email: 'tariq@zwb.mock',
      phone: null,
      full_name: 'Tariq Mehmood',
      preferred_lang: 'en',
      tenant_id: 't-zwb',
      is_active: true,
    },
    citizenId: null,
  },
};

const PROGRAMS: Program[] = [
  {
    id: 'p-sahara',
    code: 'SAHARA_WIDOW_GRANT',
    name: 'Sahara Widow Support Grant',
    name_ur: 'سہارا بیوہ امدادی گرانٹ',
    description: 'Monthly support for widowed women in low-income Sindh households.',
    description_ur: 'سندھ کے کم آمدنی والے گھرانوں کی بیوہ خواتین کے لیے امداد۔',
    required_documents: ['CNIC_FRONT', 'SPOUSE_DEATH_CERTIFICATE'],
    wizard_schema: [],
    active_rule_version_id: 'rv-sahara-1',
  },
  {
    id: 'p-guzara',
    code: 'GUZARA_ALLOWANCE',
    name: 'Guzara Allowance',
    name_ur: 'گزارہ الاؤنس',
    description: 'Zakat & Welfare Board household allowance.',
    description_ur: 'زکوٰۃ اینڈ ویلفیئر بورڈ کا گھریلو الاؤنس۔',
    required_documents: ['CNIC_FRONT'],
    wizard_schema: [],
    active_rule_version_id: 'rv-guzara-1',
  },
];

function seed(): MockDb {
  const now = new Date().toISOString();
  const fatimaCase: CaseView = {
    id: 'case-fatima-1',
    reference_code: 'HQ-2026-000142',
    program: { code: 'SAHARA_WIDOW_GRANT', name: 'Sahara Widow Support Grant', name_ur: 'سہارا بیوہ امدادی گرانٹ' },
    case_type: 'BENEFIT_APPLICATION',
    status: 'APPROVED',
    approved_amount_pkr: 15000,
    wizard_step: 'review',
    draft_answers: {},
    documents: [{ id: 'doc-1', doc_type: 'CNIC_FRONT', verify_status: 'VERIFIED' }],
    citizen_explanation: {
      headline_ur: 'آپ کی درخواست منظور ہو گئی ہے۔ 15,000 روپے بھیجے جا رہے ہیں۔',
      headline_en: 'Your application is approved. PKR 15,000 is being sent.',
      reasons_ur: [
        'آپ کا شناختی کارڈ اور بیوہ ہونے کی تصدیق ہو گئی۔',
        'گھریلو آمدنی حد کے اندر ہے (28,000 روپے)۔',
        '3 بچوں کے ساتھ کل رقم 15,000 روپے بنتی ہے۔',
      ],
      reasons_en: [
        'Your CNIC and widow status were verified.',
        'Household income is within the limit (PKR 28,000).',
        'With 3 children, your total grant is PKR 15,000.',
      ],
      next_step_ur: 'رقم آپ کے راسط نمبر پر بھیجی جائے گی اور تصدیقی کوڈ کے ساتھ پیغام ملے گا۔',
      next_step_en: 'Payment will be sent to your Raast number with a verification code SMS.',
    },
    payment: { status: 'COMPLETED', amount_pkr: 15000, external_ref: 'RAAST-99102' },
    timeline: [
      { at: now, label_ur: 'درخواست جمع ہوئی', label_en: 'Application submitted' },
      { at: now, label_ur: 'جانچ مکمل ہوئی', label_en: 'Checks completed' },
      { at: now, label_ur: 'منظور — رقم بھیجی جا رہی ہے', label_en: 'Approved — payment being sent' },
    ],
    created_at: now,
    updated_at: now,
  };

  return {
    cases: [fatimaCase],
    grants: [
      {
        id: 'g-dept',
        recipient_type: 'DEPARTMENT',
        recipient_label: 'Social Protection Department (Mock)',
        recipient_label_ur: 'محکمہ سماجی بہبود (نقلی)',
        recipient_tenant_id: 't-spd',
        recipient_user_id: null,
        categories: ['IDENTITY', 'HOUSEHOLD', 'DOCUMENTS', 'PAYMENT', 'CASE_HISTORY'],
        purposes: ['BENEFIT_APPLICATION', 'PAYMENT_DISBURSEMENT'],
        status: 'ACTIVE',
        assurance_level: 'SELF_OTP',
        granted_at: now,
        expires_at: null,
        withdrawn_at: null,
      },
      {
        id: 'g-helper',
        recipient_type: 'HELPER',
        recipient_label: 'Helper Ayesha',
        recipient_label_ur: 'مددگار عائشہ',
        recipient_tenant_id: null,
        recipient_user_id: 'u-ayesha',
        categories: ['IDENTITY', 'HOUSEHOLD', 'DOCUMENTS', 'CASE_HISTORY'],
        purposes: ['HELPER_ASSISTANCE'],
        status: 'ACTIVE',
        assurance_level: 'CITIZEN_OTP',
        granted_at: now,
        expires_at: new Date(Date.now() + 90 * 864e5).toISOString(),
        withdrawn_at: null,
      },
    ],
    accessLogs: [
      {
        id: 'al-1',
        actor_label: 'Social Protection Department',
        actor_role: 'OFFICER',
        category: 'DOCUMENTS',
        purpose: 'BENEFIT_APPLICATION',
        resource_ref: 'case:HQ-2026-000142',
        allowed: true,
        denial_reason: null,
        created_at: now,
      },
      {
        id: 'al-2',
        actor_label: 'Helper Ayesha',
        actor_role: 'HELPER',
        category: 'DOCUMENTS',
        purpose: 'HELPER_ASSISTANCE',
        resource_ref: 'case:HQ-2026-000142',
        allowed: false,
        denial_reason: 'CONSENT_REVOKED',
        created_at: now,
      },
    ],
    families: [
      {
        citizen_id: 'c-fatima',
        full_name: 'Fatima Bibi',
        avatar_color: '#0F766E',
        cnic_masked: '99900-****001-2',
        district: 'Thatta',
        active_case_count: 1,
        consent_status: 'ACTIVE',
        consent_expires_at: new Date(Date.now() + 90 * 864e5).toISOString(),
        grant_id: 'g-helper',
      },
      {
        citizen_id: 'c-zainab',
        full_name: 'Zainab Bibi',
        avatar_color: '#B4740A',
        cnic_masked: '99900-****004-5',
        district: 'Thatta',
        active_case_count: 0,
        consent_status: 'EXPIRED',
        consent_expires_at: new Date(Date.now() - 3 * 864e5).toISOString(),
        grant_id: 'g-zainab',
      },
      {
        citizen_id: 'c-mariam',
        full_name: 'Mariam Khatoon',
        avatar_color: '#1D4ED8',
        cnic_masked: '99900-****007-8',
        district: 'Sujawal',
        active_case_count: 1,
        consent_status: 'ACTIVE',
        consent_expires_at: new Date(Date.now() + 40 * 864e5).toISOString(),
        grant_id: 'g-mariam',
      },
    ],
    rules: [
      {
        id: 'rv-2',
        program_id: 'p-sahara',
        version_number: 2,
        status: 'PUBLISHED',
        rules_json: {
          version: '1.0',
          program_code: 'SAHARA_WIDOW_GRANT',
          conditions: [
            {
              id: 'r-1',
              fact: 'marital_status_widow',
              op: 'eq',
              value: true,
              on_fail: 'REJECT',
              on_unknown: 'HUMAN_REVIEW',
              reason_en: 'Applicant must be widowed.',
              reason_ur: 'درخواست دہندہ بیوہ ہونی چاہیے۔',
            },
            {
              id: 'r-2',
              fact: 'monthly_income_pkr',
              op: 'lte',
              value: 40000,
              on_fail: 'REJECT',
              on_unknown: 'HUMAN_REVIEW',
              reason_en: 'Household income must be at or below PKR 40,000.',
              reason_ur: 'گھریلو آمدنی 40,000 روپے یا اس سے کم ہونی چاہیے۔',
            },
            {
              id: 'r-3',
              fact: 'children_under_18',
              op: 'lte',
              value: 10,
              on_fail: 'HUMAN_REVIEW',
              on_unknown: 'ASK_MORE',
              reason_en: 'More than ten dependent children needs an officer look.',
              reason_ur: 'دس سے زیادہ بچوں کی صورت میں افسر جائزہ لے گا۔',
            },
          ],
          benefit: { base_amount_pkr: 12000, per_child_amount_pkr: 1000, cap_amount_pkr: 15000 },
          confidence_threshold: 0.9,
        },
        content_hash: 'sha256:9f2a4c1b7d3e',
        change_note: 'Raised income ceiling to PKR 40,000.',
        created_by: 'u-bilal',
        published_by: 'u-bilal',
        published_at: now,
        created_at: now,
      },
      {
        id: 'rv-1',
        program_id: 'p-sahara',
        version_number: 1,
        status: 'ARCHIVED',
        rules_json: {
          version: '1.0',
          program_code: 'SAHARA_WIDOW_GRANT',
          conditions: [
            {
              id: 'r-1',
              fact: 'marital_status_widow',
              op: 'eq',
              value: true,
              on_fail: 'REJECT',
              on_unknown: 'HUMAN_REVIEW',
              reason_en: 'Applicant must be widowed.',
              reason_ur: 'درخواست دہندہ بیوہ ہونی چاہیے۔',
            },
          ],
          benefit: { base_amount_pkr: 12000, per_child_amount_pkr: 1000, cap_amount_pkr: 15000 },
          confidence_threshold: 0.9,
        },
        content_hash: 'sha256:1c7b90aa42f1',
        change_note: 'Initial published version.',
        created_by: 'u-bilal',
        published_by: 'u-bilal',
        published_at: now,
        created_at: now,
      },
    ],
    auditEvents: [
      {
        seq: 1,
        id: 'ae-1',
        tenant_id: 't-spd',
        actor_type: 'SYSTEM',
        actor_id: null,
        actor_role: null,
        action: 'CASE_CREATED',
        resource_type: 'case',
        resource_id: 'case-fatima-1',
        request_id: 'req_mock_1',
        payload_json: { reference_code: 'HQ-2026-000142' },
        prev_hash: 'sha256:000000000000',
        event_hash: 'sha256:aa11bb22cc33',
        created_at: now,
      },
      {
        seq: 2,
        id: 'ae-2',
        tenant_id: 't-spd',
        actor_type: 'AI',
        actor_id: 'decision-router',
        actor_role: null,
        action: 'DECISION_ROUTED',
        resource_type: 'case',
        resource_id: 'case-fatima-1',
        request_id: 'req_mock_2',
        payload_json: { route_action: 'AUTO_APPROVE', confidence: 0.93 },
        prev_hash: 'sha256:aa11bb22cc33',
        event_hash: 'sha256:dd44ee55ff66',
        created_at: now,
      },
      {
        seq: 3,
        id: 'ae-3',
        tenant_id: 't-spd',
        actor_type: 'USER',
        actor_id: 'u-sana',
        actor_role: 'OFFICER',
        action: 'CONSENT_ACCESS_DENIED',
        resource_type: 'citizen',
        resource_id: 'c-fatima',
        request_id: 'req_mock_3',
        payload_json: { category: 'DOCUMENTS', reason: 'CONSENT_REVOKED' },
        prev_hash: 'sha256:dd44ee55ff66',
        event_hash: 'sha256:7788aabbccdd',
        created_at: now,
      },
    ],
    sms: {
      '+923001000001': [
        {
          id: 'sms-1',
          body: 'Haqdaar: آپ کی درخواست منظور ہو گئی۔ 15,000 روپے بھیجے جا رہے ہیں۔ تصدیقی کوڈ HQ-7K3P9',
          code: 'HQ-7K3P9',
          created_at: now,
        },
      ],
    },
  };
}

function load(): MockDb {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as MockDb;
  } catch {
    /* ignore corrupt fixture state */
  }
  const fresh = seed();
  save(fresh);
  return fresh;
}

function save(db: MockDb): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch {
    /* quota — fixtures are disposable */
  }
}

function notFound(): never {
  throw new ApiError({
    code: 'NOT_FOUND',
    status: 404,
    messageEn: 'Not found.',
    messageUr: 'نہیں ملا۔',
  });
}

function ok<T>(data: T, status = 200): ApiResponse<T> {
  return { data, notModified: false, etag: `W/"mock-${status}"`, status, requestId: 'req_mock' };
}

function currentUser(): User | null {
  try {
    const raw = localStorage.getItem('haqdaar.auth.v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { user?: User };
    return parsed.user ?? null;
  } catch {
    return null;
  }
}

async function mockRequestImpl(path: string, opts: RequestOptions): Promise<ApiResponse<unknown>> {
  const method = opts.method ?? 'GET';
  const db = load();
  const [rawPath, rawQuery = ''] = path.split('?');
  const p = rawPath ?? '';
  const query = new URLSearchParams(rawQuery);
  const body = (opts.body ?? {}) as Record<string, unknown>;

  // ---- auth -------------------------------------------------------------
  if (p === '/auth/demo-login' && method === 'POST') {
    const key = String(body.persona_key ?? '');
    const persona = PERSONAS[key];
    if (!persona) notFound();
    const payload: LoginResponse = {
      access_token: `mock-access-${persona.user.id}`,
      refresh_token: `mock-refresh-${persona.user.id}`,
      token_type: 'bearer',
      expires_in: 900,
      user: persona.user,
      citizen_id: persona.citizenId,
    };
    return ok(payload);
  }
  if (p === '/auth/refresh' && method === 'POST') {
    const user = currentUser();
    if (!user) {
      throw new ApiError({ code: 'UNAUTHORIZED', status: 401, messageEn: 'Session expired.', messageUr: 'سیشن ختم ہو گیا۔' });
    }
    return ok({ access_token: `mock-access-${user.id}`, refresh_token: `mock-refresh-${user.id}` });
  }
  if (p === '/auth/me') {
    const user = currentUser();
    if (!user) {
      throw new ApiError({ code: 'UNAUTHORIZED', status: 401, messageEn: 'Not signed in.', messageUr: 'لاگ ان نہیں ہیں۔' });
    }
    const me: MeResponse = {
      user,
      citizen:
        user.role === 'CITIZEN'
          ? {
              id: 'c-fatima',
              full_name: user.full_name,
              cnic_digits: '9990010000012',
              phone: user.phone,
              district: 'Thatta',
              dob: '1974-05-14',
              avatar_color: '#0F766E',
            }
          : null,
      tenant: user.tenant_id ? { id: user.tenant_id, code: 'SPD', name: 'Social Protection Department (Mock)', name_ur: 'محکمہ سماجی بہبود (نقلی)' } : null,
    };
    return ok(me);
  }

  // ---- programs ---------------------------------------------------------
  if (p === '/programs') return ok({ items: PROGRAMS, total: PROGRAMS.length, limit: 20, offset: 0 });

  // ---- cases ------------------------------------------------------------
  if (p === '/cases' && method === 'GET') {
    return ok({ items: db.cases, total: db.cases.length, limit: 20, offset: 0 });
  }
  if (p === '/cases' && method === 'POST') {
    const program = PROGRAMS.find((x) => x.id === body.program_id) ?? PROGRAMS[0];
    const created: CaseView = {
      id: uuid(),
      reference_code: `HQ-2026-${String(200 + db.cases.length).padStart(6, '0')}`,
      program: { code: program?.code ?? 'SAHARA_WIDOW_GRANT', name: program?.name ?? '', name_ur: program?.name_ur ?? '' },
      case_type: 'BENEFIT_APPLICATION',
      status: 'DRAFT',
      approved_amount_pkr: null,
      wizard_step: 'consent',
      draft_answers: {},
      documents: [],
      citizen_explanation: null,
      payment: null,
      timeline: [],
      created_at: new Date().toISOString(),
    };
    db.cases.unshift(created);
    save(db);
    return ok(created, 201);
  }

  const caseMatch = /^\/cases\/([^/]+)(\/[a-z]+)?$/.exec(p);
  if (caseMatch) {
    const id = caseMatch[1];
    const action = caseMatch[2];
    const found = db.cases.find((c) => c.id === id);
    if (!found) notFound();
    if (!action && method === 'GET') return ok(found);
    if (action === '/draft' && method === 'PATCH') {
      found.wizard_step = String(body.wizard_step ?? found.wizard_step);
      found.draft_answers = { ...found.draft_answers, ...((body.answers as CaseView['draft_answers']) ?? {}) };
      found.updated_at = new Date().toISOString();
      save(db);
      return ok(found);
    }
    if (action === '/submit' && method === 'POST') {
      found.status = 'APPROVED';
      found.approved_amount_pkr = 15000;
      found.citizen_explanation = db.cases[0]?.citizen_explanation ?? null;
      found.payment = { status: 'COMPLETED', amount_pkr: 15000, external_ref: 'RAAST-99103' };
      found.timeline = [
        { at: new Date().toISOString(), label_ur: 'درخواست جمع ہوئی', label_en: 'Application submitted' },
        { at: new Date().toISOString(), label_ur: 'منظور', label_en: 'Approved' },
      ];
      save(db);
      return ok(found);
    }
    if (action === '/complaint' && method === 'POST') {
      return ok({ ...found, id: uuid(), case_type: 'COMPLAINT', status: 'SUBMITTED' }, 201);
    }
  }

  // ---- consent ----------------------------------------------------------
  if (p === '/consent/grants' && method === 'GET') return ok({ items: db.grants, total: db.grants.length, limit: 20, offset: 0 });
  if (p === '/consent/grants' && method === 'POST') {
    const grant: ConsentGrant = {
      id: uuid(),
      recipient_type: (body.recipient_type as ConsentGrant['recipient_type']) ?? 'DEPARTMENT',
      recipient_label: 'Social Protection Department (Mock)',
      recipient_tenant_id: 't-spd',
      recipient_user_id: null,
      categories: (body.categories as ConsentGrant['categories']) ?? ['IDENTITY'],
      purposes: (body.purposes as ConsentGrant['purposes']) ?? ['BENEFIT_APPLICATION'],
      status: 'ACTIVE',
      assurance_level: (body.assurance_level as ConsentGrant['assurance_level']) ?? 'SELF_OTP',
      granted_at: new Date().toISOString(),
      expires_at: null,
      withdrawn_at: null,
    };
    db.grants.push(grant);
    save(db);
    return ok(grant, 201);
  }
  const withdrawMatch = /^\/consent\/grants\/([^/]+)\/withdraw$/.exec(p);
  if (withdrawMatch && method === 'POST') {
    const grant = db.grants.find((g) => g.id === withdrawMatch[1]);
    if (!grant) notFound();
    grant.status = 'WITHDRAWN';
    grant.withdrawn_at = new Date().toISOString();
    save(db);
    return ok(grant);
  }
  if (p === '/consent/access-logs') return ok({ items: db.accessLogs, total: db.accessLogs.length, limit: 20, offset: 0 });

  // ---- me ---------------------------------------------------------------
  if (p === '/me/data') {
    return ok({
      groups: [
        {
          category: 'IDENTITY',
          label_en: 'Identity',
          label_ur: 'شناخت',
          fields: [
            { field_key: 'applicant_full_name', label_en: 'Full name', label_ur: 'پورا نام', value: 'Fatima Bibi', source: 'SELF_DECLARED', source_type: 'SELF_DECLARED', updated_at: null },
            { field_key: 'applicant_cnic', label_en: 'CNIC', label_ur: 'شناختی کارڈ', value: '99900-1000001-2', source: 'IDENTITY_REGISTRY', source_type: 'REGISTRY', updated_at: null },
          ],
        },
      ],
    });
  }
  if (p === '/me/notifications') return ok({ items: [], total: 0, limit: 20, offset: 0 });

  // ---- helper -----------------------------------------------------------
  if (p === '/helper/families') return ok({ items: db.families, total: db.families.length, limit: 20, offset: 0 });

  // ---- officer ----------------------------------------------------------
  if (p === '/officer/queue') {
    const items: QueueItem[] = [
      {
        case_id: 'case-101',
        reference_code: 'HQ-2026-000101',
        applicant_name: 'Fatima Bibi',
        cnic_masked: '99900-****001-2',
        district: 'Thatta',
        status: 'HUMAN_REVIEW',
        priority_band: 'URGENT',
        priority_score: 96,
        latest_confidence: 0.41,
        latest_route: 'HUMAN_REVIEW',
        escalation_reasons: ['TAMPER_SUSPECTED'],
        waiting_since: new Date(Date.now() - 3600_000).toISOString(),
        assigned_officer: null,
        rule_stale: true,
        active_rule_version: 2,
        evaluated_rule_version: 1,
      },
      {
        case_id: 'case-102',
        reference_code: 'HQ-2026-000102',
        applicant_name: 'Zainab Bibi',
        cnic_masked: '99900-****004-5',
        district: 'Thatta',
        status: 'HUMAN_REVIEW',
        priority_band: 'HIGH',
        priority_score: 78,
        latest_confidence: 0.62,
        latest_route: 'HUMAN_REVIEW',
        escalation_reasons: ['DATA_CONFLICT_INCOME'],
        waiting_since: new Date(Date.now() - 7200_000).toISOString(),
        assigned_officer: null,
        rule_stale: false,
        active_rule_version: 1,
        evaluated_rule_version: 1,
      },
    ];
    const sort = query.get('sort') ?? 'priority';
    const sorted = [...items].sort((a, b) => {
      if (sort === 'confidence_asc') return (a.latest_confidence ?? 1) - (b.latest_confidence ?? 1);
      if (sort === 'oldest') return a.waiting_since.localeCompare(b.waiting_since);
      return b.priority_score - a.priority_score;
    });
    return ok({ items: sorted, total: sorted.length, limit: 20, offset: 0 });
  }

  // ---- scam -------------------------------------------------------------
  if (p === '/scam/check' && method === 'POST') {
    const text = String(body.text ?? '');
    const hasCode = /HQ-[A-Z0-9]{5}/.test(text);
    const asksFee = /fee|fees|500|faisla|bhejen|jama/i.test(text);
    const asksPin = /pin|otp|password|code batao/i.test(text);
    const verdict: ScamCheckResult['verdict'] = hasCode
      ? 'VERIFIED_OFFICIAL'
      : asksFee || asksPin
        ? 'LIKELY_SCAM'
        : text.trim().length < 15
          ? 'CANNOT_TELL'
          : 'LIKELY_SAFE';
    const result: ScamCheckResult = {
      check_id: uuid(),
      verdict,
      confidence: verdict === 'VERIFIED_OFFICIAL' ? 0.99 : verdict === 'LIKELY_SCAM' ? 0.93 : 0.55,
      red_flags:
        verdict === 'LIKELY_SCAM'
          ? [
              ...(asksFee ? [{ code: 'RF_ASKS_FEE', label_en: 'Asks for a fee', label_ur: 'فیس مانگ رہا ہے' }] : []),
              ...(asksPin ? [{ code: 'RF_ASKS_PIN_OTP', label_en: 'Asks for PIN or OTP', label_ur: 'پن یا او ٹی پی مانگ رہا ہے' }] : []),
            ]
          : [],
      matched_official: hasCode
        ? { notification_id: 'n-1', verification_code: 'HQ-7K3P9', program: 'Sahara Widow Support Grant', created_at: new Date().toISOString() }
        : null,
      explanation_ur:
        verdict === 'LIKELY_SCAM'
          ? 'یہ پیغام جعلی لگتا ہے۔ سرکاری پیغام کبھی فیس یا پن نہیں مانگتا۔'
          : verdict === 'VERIFIED_OFFICIAL'
            ? 'یہ پیغام ہماری طرف سے بھیجا گیا ہے۔ کوڈ درست ہے۔'
            : 'ہم یقین سے نہیں کہہ سکتے۔ احتیاط کریں۔',
      explanation_en:
        verdict === 'LIKELY_SCAM'
          ? 'This message looks fake. Official messages never ask for a fee or a PIN.'
          : verdict === 'VERIFIED_OFFICIAL'
            ? 'This message was sent by us. The code is valid.'
            : 'We cannot be sure. Please be careful.',
      advice_ur: 'کسی کو اپنا پن یا او ٹی پی نہ بتائیں۔',
      advice_en: 'Never share your PIN or OTP with anyone.',
    };
    return ok(result);
  }

  // ---- transparency -----------------------------------------------------
  if (p === '/transparency') {
    return ok({
      components: [
        { component: 'Auth, JWT, RBAC, Consent Engine, Audit Hash Chain', status: 'REAL', details: 'Enforced server-side in FastAPI + PostgreSQL 16.' },
        { component: 'Identity Registry (NADRA-like)', status: 'SIMULATED', details: 'Mock REST API with synthetic 99900-* CNICs.' },
      ],
      mock_services: [],
    });
  }

  // ---- mock SMS inbox ---------------------------------------------------
  const smsMatch = /^\/sms\/inbox\/(.+)$/.exec(p);
  if (smsMatch) {
    const phone = decodeURIComponent(smsMatch[1] ?? '');
    return ok({ simulated: true, service: 'sms', messages: db.sms[phone] ?? [] });
  }

  // ---- documents --------------------------------------------------------
  if (p === '/documents' && method === 'POST') {
    const docType = String((opts.form?.get('doc_type') as string | null) ?? 'CNIC_FRONT');
    return ok(
      {
        id: uuid(),
        doc_type: docType,
        verify_status: 'VERIFIED',
        verify_confidence: 0.94,
        retake_reason_ur: null,
        retake_reason_en: null,
        verify_checks: [
          { check: 'blur', passed: true, value: 182, threshold: 100, detail: 'Laplacian variance' },
          { check: 'qr_hmac', passed: true, value: 'valid', threshold: 'valid', detail: 'HMAC signature' },
          { check: 'glare', passed: true, value: 0.04, threshold: 0.15, detail: 'Specular ratio' },
        ],
        extracted_fields: { cnic_digits: '9990010000012' },
        created_at: new Date().toISOString(),
      },
      201,
    );
  }

  // ---- voice ------------------------------------------------------------
  if (p === '/voice/transcribe-parse' && method === 'POST') {
    const fieldKey = String((opts.form?.get('field_key') as string | null) ?? 'applicant_full_name');
    const numeric = fieldKey === 'monthly_income_pkr' || fieldKey === 'children_under_18' || fieldKey === 'household_size';
    const parsed = numeric ? 28000 : fieldKey === 'applicant_cnic' ? '9990010000012' : 'فاطمہ بی بی';
    return ok({
      transcript: numeric ? 'اٹھائیس ہزار روپے' : 'فاطمہ بی بی',
      parsed_value: parsed,
      confidence: 0.91,
      readback_ur: numeric ? 'آپ نے اٹھائیس ہزار روپے کہا۔ کیا یہ درست ہے؟' : 'آپ نے فاطمہ بی بی کہا۔ کیا یہ درست ہے؟',
      readback_en: numeric ? 'You said 28,000 rupees. Is that right?' : 'You said Fatima Bibi. Is that right?',
      needs_retry: false,
      missing_reason: null,
    });
  }
  if (p === '/voice/tts' && method === 'POST') {
    return ok({ audio_url: null, cached: false });
  }

  // ---- rag --------------------------------------------------------------
  if (p === '/rag/ask' && method === 'POST') {
    const question = String(body.question ?? '');
    const unsure = question.length < 6;
    return ok({
      status: unsure ? 'NOT_SURE' : 'ANSWERED',
      answer: unsure
        ? 'ہمیں یقین نہیں۔ کسی مددگار یا افسر سے پوچھیں۔'
        : 'سہارا بیوہ امدادی گرانٹ کے لیے شناختی کارڈ، شوہر کی وفات کا سرٹیفکیٹ اور گھریلو آمدنی کی معلومات درکار ہیں۔ آپ گھر سے ہی درخواست دے سکتی ہیں۔',
      citations: unsure
        ? []
        : [
            {
              doc_title: 'Sahara Widow Support Grant — Scheme Rules',
              section: '§2 Eligibility',
              version: 'v1.0',
              excerpt: 'Widowed women resident in Sindh with household income at or below PKR 40,000 per month.',
              score: 0.87,
            },
          ],
      top_score: unsure ? 0.21 : 0.87,
    });
  }

  // ---- corrections ------------------------------------------------------
  if (p === '/me/corrections' && method === 'POST') {
    return ok(
      {
        id: uuid(),
        field_key: String(body.field_key ?? ''),
        source_type: 'SELF_DECLARED',
        old_value: null,
        requested_value: body.requested_value ?? null,
        reason: (body.reason as string | null) ?? null,
        status: 'APPLIED',
        created_at: new Date().toISOString(),
      },
      201,
    );
  }

  // ---- helper onboarding ------------------------------------------------
  if (p === '/helper/families' && method === 'POST') {
    const citizenId = uuid();
    const family: HelperFamily = {
      citizen_id: citizenId,
      full_name: String((opts.form?.get('full_name') as string | null) ?? 'نیا گھرانہ'),
      avatar_color: '#6D28D9',
      cnic_masked: '99900-•••••••-2',
      district: (opts.form?.get('district') as string | null) ?? null,
      active_case_count: 0,
      consent_status: 'ACTIVE',
      consent_expires_at: null,
      grant_id: uuid(),
    };
    db.families.push(family);
    save(db);
    return ok({ citizen_id: citizenId, challenge_id: uuid() }, 201);
  }
  const helperConsentMatch = /^\/helper\/families\/([^/]+)\/consent-(otp|verify)$/.exec(p);
  if (helperConsentMatch && method === 'POST') {
    return ok({
      ok: true,
      grant_id: uuid(),
      assurance_level: helperConsentMatch[2] === 'otp' ? 'CITIZEN_OTP' : 'VERBAL_WITNESSED',
    });
  }

  // ---- officer actions --------------------------------------------------
  const officerMatch = /^\/officer\/cases\/([^/]+)\/(assign|decide|reevaluate|notes)$/.exec(p);
  if (officerMatch && method === 'POST') {
    const found = db.cases.find((c) => c.id === officerMatch[1]);
    if (!found) notFound();
    if (officerMatch[2] === 'decide') {
      const action = String(body.action ?? 'APPROVE');
      found.status = action === 'REJECT' ? 'REJECTED' : action === 'REQUEST_INFO' ? 'NEEDS_INFO' : 'APPROVED';
      found.approved_amount_pkr = found.status === 'APPROVED' ? 15000 : null;
      save(db);
    }
    return ok(found);
  }

  // ---- admin ------------------------------------------------------------
  if (p === '/admin/rules' && method === 'GET') {
    return ok({ items: db.rules, total: db.rules.length, limit: 20, offset: 0 });
  }
  if (p === '/admin/rules' && method === 'POST') {
    const base = db.rules[0];
    const next: RuleVersion = {
      id: uuid(),
      program_id: base?.program_id ?? 'p-1',
      version_number: (base?.version_number ?? 0) + 1,
      status: 'DRAFT',
      rules_json: (body.rules_json as RuleVersion['rules_json']) ?? base!.rules_json,
      content_hash: 'sha256:' + uuid().replace(/-/g, ''),
      change_note: (body.change_note as string | null) ?? null,
      created_by: currentUser()?.id ?? null,
      published_by: null,
      published_at: null,
      created_at: new Date().toISOString(),
    };
    db.rules.unshift(next);
    save(db);
    return ok(next, 201);
  }
  const rulePublishMatch = /^\/admin\/rules\/([^/]+)\/publish$/.exec(p);
  if (rulePublishMatch && method === 'POST') {
    const rule = db.rules.find((r) => r.id === rulePublishMatch[1]);
    if (!rule) notFound();
    rule.status = 'PUBLISHED';
    rule.published_at = new Date().toISOString();
    rule.change_note = (body.change_note as string | null) ?? rule.change_note;
    save(db);
    return ok(rule);
  }
  if (p === '/admin/twin' && method === 'POST') {
    return ok({
      simulation_run_id: uuid(),
      sample_size: 240,
      before_counts: { APPROVED: 118, HUMAN_REVIEW: 74, REJECTED: 48 },
      after_counts: { APPROVED: 141, HUMAN_REVIEW: 61, REJECTED: 38 },
      flipped_cases: [
        {
          case_id: 'case-104',
          reference_code: 'HQ-2026-000104',
          before_outcome: 'HUMAN_REVIEW',
          after_outcome: 'APPROVED',
          before_amount_pkr: null,
          after_amount_pkr: 15000,
          reason_en: 'Income band now within the raised threshold.',
          reason_ur: 'آمدنی کی حد بڑھنے سے اب درخواست پوری ہوتی ہے۔',
        },
      ],
      budget_delta_pkr: 345000,
    });
  }
  if (p === '/admin/users') return ok({ items: [], total: 0, limit: 20, offset: 0 });
  if (p === '/admin/api-keys' && method === 'GET') return ok({ items: [], total: 0, limit: 20, offset: 0 });
  if (p === '/admin/api-keys' && method === 'POST') {
    return ok(
      {
        id: uuid(),
        name: String(body.name ?? 'Partner key'),
        key_prefix: 'hq_live_',
        scopes: (body.scopes as string[]) ?? ['cases:read'],
        rate_limit_per_min: 60,
        is_active: true,
        last_used_at: null,
        created_at: new Date().toISOString(),
        api_key: 'hq_live_' + uuid().replace(/-/g, ''),
      },
      201,
    );
  }
  if (p === '/admin/mocks' && method === 'GET') {
    const services = ['identity', 'civil_registry', 'household_survey', 'benefits', 'raast', 'complaints', 'sms'];
    return ok({
      items: services.map((service_name) => ({
        service_name,
        mode: 'NORMAL',
        latency_ms: 120,
        failure_rate: 0,
        updated_at: new Date().toISOString(),
      })),
    });
  }
  if (p === '/admin/mocks' && method === 'PATCH') return ok({ ok: true });
  if (p === '/admin/jobs') return ok({ items: [], total: 0, limit: 20, offset: 0 });
  if (p === '/admin/reset' && method === 'POST') return ok({ ok: true, reset_at: new Date().toISOString() });

  // ---- auditor ----------------------------------------------------------
  if (p === '/auditor/events') {
    return ok({ items: db.auditEvents, total: db.auditEvents.length, limit: 20, offset: 0 });
  }
  if (p === '/auditor/verify-chain') {
    return ok({ valid: true, checked_count: db.auditEvents.length, first_broken_seq: null });
  }
  if (p === '/auditor/consents') {
    return ok({ grants: db.grants, access_logs: db.accessLogs });
  }
  const traceMatch = /^\/auditor\/cases\/([^/]+)\/trace$/.exec(p);
  if (traceMatch) {
    const found = db.cases.find((c) => c.id === traceMatch[1]) ?? db.cases[0];
    if (!found) notFound();
    return ok({
      decision_id: uuid(),
      case_id: found.id,
      reference_code: found.reference_code,
      decision_source: 'AI_ENGINE',
      actor_name: null,
      rule_version_number: 1,
      rule_content_hash: 'sha256:9f2a4c1b',
      input_snapshot_json: found.facts ?? {},
      input_snapshot_hash: 'sha256:41ab77e0',
      rule_trace_json: found.rule_trace ?? [],
      confidence_components: { identity: 0.96, documents: 0.91, data_consistency: 0.88, consent_assurance: 1, overall: 0.93 },
      confidence_overall: 0.93,
      route_action: 'AUTO_APPROVE',
      outcome_status: found.status,
      escalation_reasons: [],
      model_versions: { decision_router: 'rules-v1', scam_classifier: 'tfidf-lr-v1' },
      citizen_explanation: found.citizen_explanation ?? {
        headline_ur: 'آپ کی درخواست منظور ہو گئی ہے۔',
        headline_en: 'Your application is approved.',
        reasons_ur: [],
        reasons_en: [],
        next_step_ur: '',
        next_step_en: '',
      },
      computed_amount_pkr: 15000,
      officer_reason_codes: null,
      officer_note: null,
      is_override: false,
      created_at: new Date().toISOString(),
    });
  }

  // ---- eval & analytics -------------------------------------------------
  if (p === '/eval/dashboard') {
    const sweep = [0.7, 0.75, 0.8, 0.85, 0.9, 0.95].map((threshold) => ({
      threshold,
      auto_approve_rate: Math.max(0.1, 0.92 - threshold * 0.6),
      false_approval_rate: Math.max(0.005, (threshold - 0.6) * 0.09),
      human_review_rate: Math.min(0.9, 0.1 + threshold * 0.7),
      expected_cost: Math.round(1200 + threshold * 900),
    }));
    return ok({
      decision_router_sweep: sweep,
      active_threshold: 0.9,
      scam_classifier: {
        test_size: 600,
        precision: 0.94,
        recall: 0.91,
        f1: 0.925,
        false_positive_rate: 0.031,
        hard_negative_fpr: 0.058,
        confusion_matrix: [
          [271, 9],
          [18, 302],
        ],
        live_checks_count: 1284,
        user_disputed_count: 7,
      },
      document_verifier: {
        test_size: 400,
        genuine_verified_rate: 0.962,
        tampered_caught_rate: 0.905,
        false_tamper_rate: 0.021,
        blurry_retake_rate: 0.074,
      },
      live_operations: {
        total_decisions: 412,
        by_route: { AUTO_APPROVE: 231, HUMAN_REVIEW: 128, ASK_MORE: 41, WAIT_EXTERNAL: 12 },
        officer_override_rate: 0.068,
        latency_p50_ms: 1840,
        latency_p95_ms: 6120,
        llm_calls_24h: 318,
        llm_cost_usd_24h: 2.41,
        llm_failure_rate: 0.012,
      },
    });
  }
  if (p === '/analytics/tenant') {
    return ok({
      tenant: { id: 't-spd', code: 'SPD', name: 'Social Protection Department' },
      cases_by_status: { APPROVED: 231, HUMAN_REVIEW: 128, REJECTED: 41, PAID: 198 },
      avg_time_to_decision_hours: 6.4,
      auto_approve_pct: 56.1,
      disbursed_pkr: 3465000,
      top_flags: [
        { code: 'INCOME_CONFLICT', count: 34 },
        { code: 'DOC_BLURRY', count: 21 },
        { code: 'SPOUSE_CNIC_UNKNOWN', count: 18 },
      ],
    });
  }

  notFound();
}

/**
 * Typed façade over the fixture layer. The fixtures are untyped JSON-ish data,
 * so the single cast lives here rather than at every call site.
 */
export async function mockRequest<T>(path: string, opts: RequestOptions): Promise<ApiResponse<T>> {
  return (await mockRequestImpl(path, opts)) as ApiResponse<T>;
}

import type { CaseDetail, CaseStatus, ConsentGrant, DataCategory, DecideRequest, QueueCard, RuleSet, ScamCheckResponse } from '../api/types';
import { audit, db, delay, E, HttpError, page, requireRole, resetState, save, tokenFor, verifyChain, type Ctx } from './core';
import { amountFor, evaluate, priority, route, twin, validateRules } from './engine';
import { checkComplaint, notify, scheduleProcess, schedulePayment } from './pipeline';
import { hashRules, type MCase, type MCitizen } from './state';
import { answerQuestion } from './rag';
import { evalDashboard } from './evalData';
import { id, maskCnic, now, sha256 } from './util';

type Handler = (ctx: Ctx, req: { params: Record<string, string>; query: URLSearchParams; body: unknown; form?: FormData; headers: Headers }) => unknown | Promise<unknown>;
export const routes: [string, RegExp, Handler][] = [];
function on(method: string, pattern: string, h: Handler) {
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`);
  routes.push([method, re, h]);
}

const ALLOWED: Record<CaseStatus, CaseStatus[]> = {
  DRAFT: ['SUBMITTED', 'WITHDRAWN'],
  SUBMITTED: ['PROCESSING', 'ON_HOLD_CONSENT'],
  PROCESSING: ['APPROVED', 'NEEDS_INFO', 'HUMAN_REVIEW', 'WAITING_EXTERNAL', 'ON_HOLD_CONSENT'],
  WAITING_EXTERNAL: ['PROCESSING', 'HUMAN_REVIEW', 'ON_HOLD_CONSENT'],
  NEEDS_INFO: ['SUBMITTED', 'HUMAN_REVIEW', 'ON_HOLD_CONSENT', 'WITHDRAWN'],
  HUMAN_REVIEW: ['IN_REVIEW', 'ON_HOLD_CONSENT'],
  IN_REVIEW: ['APPROVED', 'PENDING_SECOND_APPROVAL', 'REJECTED', 'NEEDS_INFO', 'HUMAN_REVIEW', 'ON_HOLD_CONSENT'],
  PENDING_SECOND_APPROVAL: ['APPROVED', 'IN_REVIEW', 'REJECTED', 'ON_HOLD_CONSENT'],
  ON_HOLD_CONSENT: ['WITHDRAWN', 'SUBMITTED', 'PROCESSING', 'WAITING_EXTERNAL', 'NEEDS_INFO', 'HUMAN_REVIEW', 'IN_REVIEW', 'PENDING_SECOND_APPROVAL'],
  APPROVED: ['PAYMENT_INITIATED', 'CLOSED'],
  PAYMENT_INITIATED: ['PAID', 'PAYMENT_FAILED'],
  PAID: ['CLOSED'],
  PAYMENT_FAILED: ['PAYMENT_INITIATED', 'HUMAN_REVIEW', 'CLOSED'],
  REJECTED: ['CLOSED'],
  WITHDRAWN: [],
  CLOSED: [],
};

function transition(c: MCase, to: CaseStatus) {
  if (!ALLOWED[c.status].includes(to)) throw E.transition(c.status, to);
  c.previous_status = c.status;
  c.status = to;
  c.updated_at = now();
}

const tl = (c: MCase, en: string, ur: string) => c.timeline.push({ at: now(), label_en: en, label_ur: ur });

// ---------------- consent enforcement (single point, like security/consent.py) ----------------
function enforce(ctx: Ctx, citizenId: string, category: DataCategory, resource: string, tenantId: string | null): void {
  const s = db();
  const u = ctx.user!;
  if (u.role === 'CITIZEN' || u.role === 'AUDITOR') return;
  let grant: ConsentGrant | undefined;
  let label = u.full_name;
  if (u.role === 'HELPER') {
    grant = s.grants.find((g) => g.citizen_id === citizenId && g.recipient_type === 'HELPER' && g.recipient_user_id === u.id && g.status === 'ACTIVE');
    label = `Helper ${u.full_name}`;
  } else {
    grant = s.grants.find((g) => g.citizen_id === citizenId && g.recipient_type === 'DEPARTMENT' && g.recipient_tenant_id === (tenantId ?? u.tenant_id) && g.status === 'ACTIVE');
    label = `${s.tenants.find((t) => t.id === u.tenant_id)?.code ?? 'Dept'} · ${u.full_name}`;
  }
  const allowed = !!grant && grant.categories.includes(category);
  const prior = s.grants.find((g) => g.citizen_id === citizenId && (u.role === 'HELPER' ? g.recipient_user_id === u.id : g.recipient_tenant_id === u.tenant_id));
  const reason = allowed ? null : !prior ? 'NO_CONSENT' : prior.status === 'EXPIRED' ? 'CONSENT_EXPIRED' : prior.status === 'WITHDRAWN' ? 'CONSENT_REVOKED' : 'CATEGORY_NOT_GRANTED';
  s.accessLogs.unshift({
    id: id('acc'),
    citizen_id: citizenId,
    tenant_id: u.tenant_id,
    actor_label: label,
    actor_role: u.role,
    category,
    purpose: u.role === 'HELPER' ? 'HELPER_ASSISTANCE' : 'BENEFIT_APPLICATION',
    resource_ref: resource,
    allowed,
    denial_reason: reason,
    created_at: now(),
  });
  audit({ ctx, action: allowed ? 'consent.access_allowed' : 'consent.access_denied', resource_type: 'citizen', resource_id: citizenId, payload: { category, resource, reason } });
  if (!allowed) throw E.consent(category);
}

function citizenFor(ctx: Ctx): MCitizen {
  const s = db();
  const u = ctx.user!;
  if (u.role === 'CITIZEN') {
    const c = s.citizens.find((x) => x.user_id === u.id);
    if (!c) throw E.notFound();
    return c;
  }
  if (u.role === 'HELPER') {
    if (!ctx.actFor) throw E.validation({ 'X-Act-For-Citizen': 'required' });
    const c = s.citizens.find((x) => x.id === ctx.actFor);
    // Unknown or never-granted families look like "not found" (no existence leak).
    if (!c || !s.grants.some((g) => g.citizen_id === c.id && g.recipient_user_id === u.id)) throw E.notFound();
    return c;
  }
  throw E.forbidden();
}

function programRef(programId: string) {
  const p = db().programs.find((x) => x.id === programId)!;
  return { id: p.id, code: p.code, name: p.name, name_ur: p.name_ur };
}

function summary(c: MCase) {
  return { id: c.id, reference_code: c.reference_code, program: programRef(c.program_id), case_type: c.case_type, status: c.status, approved_amount_pkr: c.approved_amount_pkr, updated_at: c.updated_at, created_at: c.created_at };
}

function detail(c: MCase, staff: boolean): CaseDetail {
  const s = db();
  const docs = s.documents.filter((d) => d.case_id === c.id).map((d) => ({ id: d.id, doc_type: d.doc_type, verify_status: d.verify_status, verify_confidence: d.verify_confidence, retake_reason_ur: d.retake_reason_ur, retake_reason_en: d.retake_reason_en, verify_checks: staff ? d.verify_checks : undefined, extracted_fields: staff ? d.extracted_fields : undefined, created_at: d.created_at }));
  const base: CaseDetail = {
    ...summary(c),
    wizard_step: c.wizard_step,
    draft_answers: c.draft_answers,
    documents: docs,
    citizen_explanation: c.citizen_explanation,
    payment: c.payment ? { status: c.payment.status, amount_pkr: c.payment.amount_pkr, external_ref: c.payment.external_ref, failure_reason: c.payment.failure_reason } : null,
    timeline: c.timeline,
    parent_case_id: c.parent_case_id,
    submitted_via_helper: c.submitted_via_helper,
  };
  if (!staff) return base;
  const cit = s.citizens.find((x) => x.id === c.citizen_id)!;
  const rv = s.ruleVersions.find((r) => r.id === c.latest_rule_version_id);
  const program = s.programs.find((p) => p.id === c.program_id)!;
  const active = s.ruleVersions.find((r) => r.id === program.active_rule_version_id);
  const user = (uid: string | null) => (uid ? { id: uid, full_name: s.users.find((u) => u.id === uid)?.full_name ?? uid } : null);
  return {
    ...base,
    citizen: { id: cit.id, full_name: cit.full_name, cnic_masked: maskCnic(cit.cnic_digits), district: cit.district, avatar_color: cit.avatar_color },
    facts: c.facts,
    rule_trace: c.rule_trace,
    flags: c.flags,
    ai_case_note: c.ai_case_note,
    confidence_components: c.confidence,
    latest_confidence: c.latest_confidence,
    latest_route: c.latest_route,
    priority_band: c.priority_band,
    priority_score: c.priority_score,
    assigned_officer: user(c.assigned_officer_id),
    first_approver: user(c.first_approver_id),
    rule_version: rv ? { id: rv.id, version_number: rv.version_number, content_hash: rv.content_hash } : null,
    active_rule_version: active ? { id: active.id, version_number: active.version_number, content_hash: active.content_hash } : null,
    agent_steps: c.agent_steps,
    notes: c.notes,
    ask_more_rounds: c.ask_more_rounds,
  };
}

function findCaseForStaff(ctx: Ctx, caseId: string): MCase {
  const c = db().cases.find((x) => x.id === caseId);
  const u = ctx.user!;
  if (!c || (u.tenant_id && c.tenant_id !== u.tenant_id)) throw E.notFound();
  return c;
}

// ======================= AUTH =======================
function tokens(userId: string) {
  const s = db();
  const u = s.users.find((x) => x.id === userId)!;
  const cit = s.citizens.find((c) => c.user_id === u.id);
  audit({ actor_type: 'USER', actor_id: u.id, actor_role: u.role, tenant_id: u.tenant_id, action: 'auth.login', resource_type: 'user', resource_id: u.id });
  return { access_token: tokenFor(u.id), refresh_token: tokenFor(u.id), user: publicUser(u), citizen_id: cit?.id ?? null };
}
const publicUser = (u: ReturnType<typeof db>['users'][number]) => ({ id: u.id, role: u.role, full_name: u.full_name, email: u.email, phone: u.phone, tenant_id: u.tenant_id, is_active: u.is_active, created_at: u.created_at });

on('POST', '/auth/demo-login', (_c, { body }) => {
  const key = (body as { persona_key: string }).persona_key;
  const u = db().users.find((x) => x.persona_key === key);
  if (!u) throw E.notFound();
  return tokens(u.id);
});
on('POST', '/auth/login', (_c, { body }) => {
  const { email, password } = body as { email: string; password: string };
  const u = db().users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
  if (!u || password !== 'Demo@2026') throw new HttpError(401, 'UNAUTHORIZED', 'Email or password is wrong.', 'ای میل یا پاس ورڈ غلط ہے۔');
  return tokens(u.id);
});
on('POST', '/auth/otp/request', (_c, { body }) => {
  const { phone } = body as { phone: string };
  const s = db();
  const recent = s.otps.filter((o) => o.phone === phone && Date.now() - new Date(o.created_at).getTime() < 600000);
  if (recent.length >= 3) throw new HttpError(429, 'RATE_LIMITED', 'Too many codes. Try again in 10 minutes.', 'بہت زیادہ کوڈ۔ 10 منٹ بعد کوشش کریں۔');
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const o = { id: id('otp'), phone, code, purpose: 'LOGIN' as const, created_at: now(), consumed: false };
  s.otps.unshift(o);
  save();
  return { challenge_id: o.id, expires_in_sec: 300, simulated_sms_hint: 'Check Device Simulator inbox' };
});
on('POST', '/auth/otp/verify', (_c, { body }) => {
  const { challenge_id, code } = body as { challenge_id: string; code: string };
  const s = db();
  const o = s.otps.find((x) => x.id === challenge_id && !x.consumed);
  if (!o || o.code !== code) throw new HttpError(401, 'INVALID_OTP', 'Wrong or expired code.', 'کوڈ غلط یا پرانا ہے۔');
  o.consumed = true;
  let u = s.users.find((x) => x.phone === o.phone && x.role === 'CITIZEN');
  if (!u) {
    u = { id: id('user'), role: 'CITIZEN', full_name: 'New citizen', email: null, phone: o.phone, tenant_id: null, is_active: true, created_at: now() };
    s.users.push(u);
    s.citizens.push({ id: id('cit'), user_id: u.id, full_name: 'New citizen', cnic_digits: null, phone: o.phone, district: null, dob: null, avatar_color: '#0F766E', profile: {}, created_by_user_id: null });
  }
  return tokens(u.id);
});
on('POST', '/auth/refresh', (_c, { body }) => {
  const m = String((body as { refresh_token: string }).refresh_token).match(/^mock\.([^.]+)\./);
  if (!m) throw E.unauthorized();
  return { access_token: tokenFor(m[1]), refresh_token: tokenFor(m[1]) };
});
on('POST', '/auth/logout', () => ({ ok: true }));
on('GET', '/auth/me', (ctx) => {
  if (!ctx.user) throw E.unauthorized();
  const s = db();
  const cit = s.citizens.find((c) => c.user_id === ctx.user!.id);
  return {
    user: publicUser(ctx.user),
    citizen: cit ? { id: cit.id, full_name: cit.full_name, cnic_masked: maskCnic(cit.cnic_digits), phone: cit.phone, district: cit.district, dob: cit.dob, avatar_color: cit.avatar_color } : null,
    tenant: s.tenants.find((t) => t.id === ctx.user!.tenant_id) ?? null,
  };
});

// ======================= PROGRAMS & CASES =======================
on('GET', '/programs', (ctx) => {
  requireRole(ctx, 'CITIZEN', 'HELPER', 'OFFICER', 'ADMIN', 'AUDITOR');
  const u = ctx.user!;
  return db().programs.filter((p) => !u.tenant_id || p.tenant_id === u.tenant_id);
});

on('GET', '/cases', (ctx) => {
  requireRole(ctx, 'CITIZEN', 'HELPER');
  const cit = citizenFor(ctx);
  enforce(ctx, cit.id, 'CASE_HISTORY', `citizen:${cit.id}`, null);
  return db().cases.filter((c) => c.citizen_id === cit.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(summary);
});

on('GET', '/cases/:id', (ctx, { params }) => {
  const u = requireRole(ctx, 'CITIZEN', 'HELPER', 'OFFICER', 'AUDITOR', 'ADMIN');
  const s = db();
  if (u.role === 'CITIZEN' || u.role === 'HELPER') {
    const cit = citizenFor(ctx);
    const c = s.cases.find((x) => x.id === params.id && x.citizen_id === cit.id);
    if (!c) throw E.notFound();
    enforce(ctx, cit.id, 'CASE_HISTORY', `case:${c.reference_code}`, c.tenant_id);
    return detail(c, false);
  }
  const c = findCaseForStaff(ctx, params.id);
  enforce(ctx, c.citizen_id, 'CASE_HISTORY', `case:${c.reference_code}`, c.tenant_id);
  return detail(c, true);
});

on('POST', '/cases', (ctx, { body }) => {
  requireRole(ctx, 'CITIZEN', 'HELPER');
  const cit = citizenFor(ctx);
  const s = db();
  const { program_id } = body as { program_id: string };
  const p = s.programs.find((x) => x.id === program_id);
  if (!p) throw E.notFound();
  if (!s.grants.some((g) => g.citizen_id === cit.id && g.recipient_type === 'DEPARTMENT' && g.recipient_tenant_id === p.tenant_id && g.status === 'ACTIVE')) throw E.consent('IDENTITY');
  s.refCounter += 1;
  const c: MCase = {
    id: id('case'),
    reference_code: `HQ-2026-${String(s.refCounter).padStart(6, '0')}`,
    tenant_id: p.tenant_id!,
    program_id: p.id,
    citizen_id: cit.id,
    submitted_by_user_id: ctx.user!.id,
    submitted_via_helper: ctx.user!.role === 'HELPER',
    case_type: 'BENEFIT_APPLICATION',
    parent_case_id: null,
    status: 'DRAFT',
    previous_status: null,
    assigned_officer_id: null,
    first_approver_id: null,
    priority_score: 0,
    priority_band: 'NORMAL',
    latest_confidence: null,
    latest_route: null,
    latest_rule_version_id: null,
    approved_amount_pkr: null,
    ask_more_rounds: 0,
    wizard_step: 'applicant_full_name',
    draft_answers: {},
    flags: [],
    ai_case_note: null,
    citizen_explanation: null,
    facts: {},
    rule_trace: [],
    confidence: null,
    timeline: [{ at: now(), label_en: 'Application started', label_ur: 'درخواست شروع' }],
    agent_steps: [],
    notes: [],
    payment: null,
    submitted_at: null,
    decided_at: null,
    created_at: now(),
    updated_at: now(),
  };
  s.cases.push(c);
  audit({ ctx, action: 'case.created', resource_type: 'case', resource_id: c.id, tenant_id: c.tenant_id, payload: { via_helper: c.submitted_via_helper } });
  return detail(c, false);
});

on('PATCH', '/cases/:id/draft', (ctx, { params, body }) => {
  requireRole(ctx, 'CITIZEN', 'HELPER');
  const cit = citizenFor(ctx);
  const c = db().cases.find((x) => x.id === params.id && x.citizen_id === cit.id);
  if (!c) throw E.notFound();
  if (!['DRAFT', 'NEEDS_INFO'].includes(c.status)) throw E.transition(c.status, 'DRAFT');
  const b = body as { wizard_step: string; answers: CaseDetail['draft_answers'] };
  c.draft_answers = { ...c.draft_answers, ...b.answers };
  c.wizard_step = b.wizard_step;
  c.updated_at = now();
  audit({ ctx, action: 'case.draft_saved', resource_type: 'case', resource_id: c.id, tenant_id: c.tenant_id, payload: { fields: Object.keys(b.answers) } });
  return detail(c, false);
});

on('POST', '/cases/:id/submit', (ctx, { params }) => {
  requireRole(ctx, 'CITIZEN', 'HELPER');
  const cit = citizenFor(ctx);
  const s = db();
  const c = s.cases.find((x) => x.id === params.id && x.citizen_id === cit.id);
  if (!c) throw E.notFound();
  const required = ['applicant_full_name', 'applicant_district', 'children_under_18', 'monthly_income_pkr', 'payout_phone'];
  const missing = required.filter((k) => !c.draft_answers[k]?.confirmed);
  if (missing.length) throw E.validation(Object.fromEntries(missing.map((k) => [k, 'required'])));
  transition(c, 'SUBMITTED');
  c.submitted_at = now();
  tl(c, 'Application submitted', 'درخواست جمع ہوئی');
  audit({ ctx, action: 'case.submitted', resource_type: 'case', resource_id: c.id, tenant_id: c.tenant_id });
  scheduleProcess(c.id);
  return detail(c, false);
});

on('POST', '/cases/:id/withdraw', (ctx, { params }) => {
  requireRole(ctx, 'CITIZEN', 'HELPER');
  const cit = citizenFor(ctx);
  const c = db().cases.find((x) => x.id === params.id && x.citizen_id === cit.id);
  if (!c) throw E.notFound();
  transition(c, 'WITHDRAWN');
  tl(c, 'Application withdrawn', 'درخواست واپس لی گئی');
  audit({ ctx, action: 'case.withdrawn', resource_type: 'case', resource_id: c.id, tenant_id: c.tenant_id });
  return detail(c, false);
});

on('POST', '/cases/:id/complaint', (ctx, { params }) => {
  requireRole(ctx, 'CITIZEN', 'HELPER');
  const cit = citizenFor(ctx);
  const s = db();
  const parent = s.cases.find((x) => x.id === params.id && x.citizen_id === cit.id);
  if (!parent) throw E.notFound();
  if (!['APPROVED', 'PAID', 'PAYMENT_FAILED'].includes(parent.status)) throw E.transition(parent.status, 'COMPLAINT');
  s.refCounter += 1;
  const comp: MCase = {
    ...parent,
    id: id('case'),
    reference_code: `HQ-2026-${String(s.refCounter).padStart(6, '0')}`,
    case_type: 'COMPLAINT',
    parent_case_id: parent.id,
    status: 'PROCESSING',
    approved_amount_pkr: null,
    payment: null,
    notes: [],
    agent_steps: [],
    timeline: [{ at: now(), label_en: 'Complaint: money not received', label_ur: 'شکایت: رقم نہیں ملی' }],
    citizen_explanation: null,
    created_at: now(),
    updated_at: now(),
  };
  s.cases.push(comp);
  audit({ ctx, action: 'complaint.created', resource_type: 'case', resource_id: comp.id, tenant_id: comp.tenant_id, payload: { parent: parent.reference_code } });
  checkComplaint(comp, parent);
  return detail(comp, false);
});

// ======================= DOCUMENTS =======================
async function blurScore(file: Blob): Promise<number> {
  try {
    const bmp = await createImageBitmap(file);
    const w = Math.min(320, bmp.width);
    const h = Math.round((bmp.height / bmp.width) * w);
    const cv = new OffscreenCanvas(w, h);
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const g = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    let sum = 0;
    let sq = 0;
    let n = 0;
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const lap = g[i - w] + g[i + w] + g[i - 1] + g[i + 1] - 4 * g[i];
        sum += lap;
        sq += lap * lap;
        n++;
      }
    const mean = sum / n;
    return sq / n - mean * mean; // Laplacian variance (same metric as OpenCV in doc_verify.py)
  } catch {
    return 999;
  }
}

on('POST', '/documents', async (ctx, { form }) => {
  requireRole(ctx, 'CITIZEN', 'HELPER');
  const cit = citizenFor(ctx);
  const file = form?.get('file');
  if (!(file instanceof Blob)) throw E.validation({ file: 'required' });
  if (file.size > 2 * 1024 * 1024) throw new HttpError(413, 'FILE_TOO_LARGE', 'Photo is larger than 2 MB.', 'تصویر 2 MB سے بڑی ہے۔');
  const docType = String(form?.get('doc_type')) as 'CNIC_FRONT';
  const caseId = form?.get('case_id') ? String(form.get('case_id')) : null;
  const s = db();
  const c = caseId ? s.cases.find((x) => x.id === caseId && x.citizen_id === cit.id) : undefined;
  await delay(700);
  const blur = await blurScore(file);
  const sharp = blur >= 60;
  const status = sharp ? 'VERIFIED' : 'NEEDS_RETAKE';
  const d = {
    id: id('doc'),
    tenant_id: c?.tenant_id ?? 'tenant-spd',
    citizen_id: cit.id,
    case_id: c?.id ?? null,
    doc_type: docType,
    verify_status: status as 'VERIFIED' | 'NEEDS_RETAKE',
    verify_confidence: sharp ? 0.95 : 0.4,
    verify_checks: [
      { check: 'blur_laplacian_variance', passed: sharp, value: Math.round(blur), threshold: 60, detail: sharp ? 'Image is sharp' : 'Image too blurry' },
      { check: 'qr_signature_hmac', passed: sharp, value: sharp ? 'valid' : 'not read', threshold: 'HMAC-SHA256', detail: 'Simulated in dev mock' },
      { check: 'ocr_vs_qr_name', passed: sharp, value: sharp ? 0.96 : null, threshold: 0.85, detail: 'Simulated in dev mock' },
    ],
    extracted_fields: sharp ? { full_name: cit.full_name, cnic: cit.cnic_digits } : {},
    retake_reason_ur: sharp ? null : 'تصویر دھندلی ہے۔ فون کو ساکن رکھیں اور روشنی میں دوبارہ تصویر لیں۔',
    retake_reason_en: sharp ? null : 'The photo is blurry. Hold the phone steady in good light and try again.',
    data_url: URL.createObjectURL(file),
    created_at: now(),
  };
  s.documents.push(d);
  audit({ ctx, actor_type: 'AI', actor_id: 'doc_verify', action: 'document.verified', resource_type: 'document', resource_id: d.id, tenant_id: d.tenant_id, payload: { status, blur: Math.round(blur) } });
  const { data_url: _omit, ...pub } = d;
  void _omit;
  return pub;
});

// ======================= CONSENT & MY DATA =======================
on('GET', '/consent/grants', (ctx) => {
  requireRole(ctx, 'CITIZEN', 'HELPER');
  const cit = citizenFor(ctx);
  const all = db().grants.filter((g) => g.citizen_id === cit.id);
  return ctx.user!.role === 'HELPER' ? all.filter((g) => g.recipient_user_id === ctx.user!.id) : all;
});
on('POST', '/consent/grants', (ctx, { body }) => {
  requireRole(ctx, 'CITIZEN', 'HELPER');
  const cit = citizenFor(ctx);
  const s = db();
  const b = body as Omit<ConsentGrant, 'id'>;
  const tenant = s.tenants.find((t) => t.id === b.recipient_tenant_id);
  const existing = s.grants.find((g) => g.citizen_id === cit.id && g.recipient_type === b.recipient_type && g.recipient_tenant_id === (b.recipient_tenant_id ?? null) && g.recipient_user_id === (b.recipient_user_id ?? null) && g.status === 'ACTIVE');
  if (existing) return existing;
  const helperUser = s.users.find((u) => u.id === b.recipient_user_id);
  const g: ConsentGrant = {
    id: id('grant'),
    citizen_id: cit.id,
    recipient_type: b.recipient_type,
    recipient_label: b.recipient_type === 'DEPARTMENT' ? `${tenant?.name ?? 'Department'}` : `Helper ${helperUser?.full_name ?? ''}`,
    recipient_tenant_id: b.recipient_tenant_id ?? null,
    recipient_user_id: b.recipient_user_id ?? null,
    categories: b.categories,
    purposes: b.purposes,
    status: 'ACTIVE',
    assurance_level: b.assurance_level,
    granted_at: now(),
    expires_at: b.recipient_type === 'HELPER' ? new Date(Date.now() + 90 * 864e5).toISOString() : null,
    withdrawn_at: null,
  };
  s.grants.push(g);
  audit({ ctx, action: 'consent.granted', resource_type: 'consent_grant', resource_id: g.id, payload: { recipient: g.recipient_label, categories: g.categories } });
  // AC-11.4: re-granting resumes paused cases.
  for (const c of s.cases.filter((x) => x.citizen_id === cit.id && x.status === 'ON_HOLD_CONSENT' && x.tenant_id === g.recipient_tenant_id)) {
    const back = c.previous_status ?? 'HUMAN_REVIEW';
    c.status = back;
    c.previous_status = 'ON_HOLD_CONSENT';
    tl(c, 'Resumed: permission given again', 'دوبارہ شروع: اجازت دوبارہ دی گئی');
    if (back === 'SUBMITTED' || back === 'PROCESSING') {
      c.status = 'SUBMITTED';
      scheduleProcess(c.id);
    }
  }
  return g;
});
on('PATCH', '/consent/grants/:id', (ctx, { params, body }) => {
  requireRole(ctx, 'CITIZEN');
  const cit = citizenFor(ctx);
  const g = db().grants.find((x) => x.id === params.id && x.citizen_id === cit.id);
  if (!g) throw E.notFound();
  Object.assign(g, body);
  audit({ ctx, action: 'consent.modified', resource_type: 'consent_grant', resource_id: g.id, payload: body as Record<string, unknown> });
  return g;
});
on('POST', '/consent/grants/:id/withdraw', (ctx, { params, body }) => {
  requireRole(ctx, 'CITIZEN');
  const cit = citizenFor(ctx);
  const s = db();
  const g = s.grants.find((x) => x.id === params.id && x.citizen_id === cit.id);
  if (!g) throw E.notFound();
  const open = s.cases.filter((c) => c.citizen_id === cit.id && c.tenant_id === g.recipient_tenant_id && !['DRAFT', 'APPROVED', 'PAYMENT_INITIATED', 'PAID', 'PAYMENT_FAILED', 'REJECTED', 'WITHDRAWN', 'CLOSED', 'ON_HOLD_CONSENT'].includes(c.status));
  if (g.recipient_type === 'DEPARTMENT' && open.length && !(body as { confirm_case_hold?: boolean })?.confirm_case_hold)
    throw E.validation({ confirm_case_hold: 'Withdrawing pauses your open application. Confirm to continue.' });
  g.status = 'WITHDRAWN';
  g.withdrawn_at = now();
  if (g.recipient_type === 'DEPARTMENT') {
    for (const c of open) {
      c.previous_status = c.status;
      c.status = 'ON_HOLD_CONSENT';
      tl(c, 'Paused: permission withdrawn', 'رکی ہوئی: اجازت واپس لی گئی');
    }
  }
  audit({ ctx, action: 'consent.withdrawn', resource_type: 'consent_grant', resource_id: g.id, payload: { recipient: g.recipient_label, cases_on_hold: g.recipient_type === 'DEPARTMENT' ? open.length : 0 } });
  return g;
});
on('GET', '/consent/access-logs', (ctx, { query }) => {
  const u = requireRole(ctx, 'CITIZEN', 'AUDITOR');
  const s = db();
  if (u.role === 'AUDITOR') return page(s.accessLogs, query);
  const cit = citizenFor(ctx);
  return page(s.accessLogs.filter((l) => l.citizen_id === cit.id), query);
});

const FIELD_LABELS: Record<string, [string, string, DataCategory]> = {
  applicant_full_name: ['Full name', 'پورا نام', 'IDENTITY'],
  applicant_cnic: ['CNIC', 'شناختی کارڈ', 'IDENTITY'],
  applicant_dob: ['Date of birth', 'تاریخ پیدائش', 'IDENTITY'],
  applicant_district: ['District', 'ضلع', 'HOUSEHOLD'],
  children_under_18: ['Children under 18', '18 سال سے کم بچے', 'HOUSEHOLD'],
  household_size: ['Household size', 'گھر کے افراد', 'HOUSEHOLD'],
  monthly_income_pkr: ['Monthly income', 'ماہانہ آمدنی', 'HOUSEHOLD'],
  payout_phone: ['Payout number', 'ادائیگی نمبر', 'PAYMENT'],
};
on('GET', '/me/data', (ctx) => {
  requireRole(ctx, 'CITIZEN', 'HELPER');
  const cit = citizenFor(ctx);
  enforce(ctx, cit.id, 'IDENTITY', `citizen:${cit.id}`, null);
  const s = db();
  const latest = s.cases.filter((c) => c.citizen_id === cit.id).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  const reg = s.registry.find((r) => r.cnic === cit.cnic_digits);
  const groups: Record<string, { key: string; label_en: string; label_ur: string; value: unknown; source_type: 'SELF_DECLARED' | 'REGISTRY'; source_label?: string }[]> = {};
  const push = (k: string, value: unknown, src: 'SELF_DECLARED' | 'REGISTRY', label?: string) => {
    const [en, ur, cat] = FIELD_LABELS[k];
    (groups[cat] ??= []).push({ key: k, label_en: en, label_ur: ur, value, source_type: src, source_label: label });
  };
  push('applicant_full_name', reg?.full_name ?? cit.full_name, reg ? 'REGISTRY' : 'SELF_DECLARED', reg ? 'Identity registry (simulated)' : undefined);
  push('applicant_cnic', maskCnic(cit.cnic_digits), reg ? 'REGISTRY' : 'SELF_DECLARED');
  push('applicant_dob', reg?.dob ?? cit.dob, reg ? 'REGISTRY' : 'SELF_DECLARED');
  for (const k of ['applicant_district', 'children_under_18', 'household_size', 'monthly_income_pkr', 'payout_phone']) {
    const a = latest?.draft_answers[k];
    const f = latest?.facts[k];
    if (f?.state === 'KNOWN' && f.source !== 'SELF_DECLARED') push(k, f.value, 'REGISTRY', f.source ?? undefined);
    else push(k, a?.value ?? (k === 'applicant_district' ? cit.district : null), 'SELF_DECLARED');
  }
  return {
    groups: Object.entries(groups).map(([category, fields]) => ({ category, fields })),
    corrections: s.corrections.filter((c) => c.citizen_id === cit.id),
  };
});
on('POST', '/me/corrections', (ctx, { body }) => {
  requireRole(ctx, 'CITIZEN', 'HELPER');
  const cit = citizenFor(ctx);
  const s = db();
  const b = body as { field_key: string; requested_value: unknown; reason: string };
  const registryField = ['applicant_full_name', 'applicant_cnic', 'applicant_dob', 'household_size', 'monthly_income_pkr'].includes(b.field_key) && !!s.registry.find((r) => r.cnic === cit.cnic_digits);
  const cr = { id: id('cor'), citizen_id: cit.id, citizen_name: cit.full_name, field_key: b.field_key, source_type: (registryField ? 'REGISTRY' : 'SELF_DECLARED') as 'REGISTRY' | 'SELF_DECLARED', old_value: null, requested_value: b.requested_value, reason: b.reason, status: (registryField ? 'PENDING_OFFICER' : 'APPLIED') as 'PENDING_OFFICER' | 'APPLIED', created_at: now() };
  s.corrections.unshift(cr);
  if (!registryField) {
    for (const c of s.cases.filter((x) => x.citizen_id === cit.id && ['DRAFT', 'NEEDS_INFO'].includes(x.status))) c.draft_answers[b.field_key] = { value: b.requested_value as string, confirmed: true, entered_by: 'CITIZEN' };
  }
  audit({ ctx, action: 'data.correction_requested', resource_type: 'citizen', resource_id: cit.id, payload: { field: b.field_key, status: cr.status } });
  return cr;
});
on('GET', '/me/notifications', (ctx) => {
  requireRole(ctx, 'CITIZEN', 'HELPER');
  const cit = citizenFor(ctx);
  return db().notifications.filter((n) => n.citizen_id === cit.id);
});

// ======================= HELPER =======================
on('GET', '/helper/families', (ctx) => {
  const u = requireRole(ctx, 'HELPER');
  const s = db();
  const grants = s.grants.filter((g) => g.recipient_type === 'HELPER' && g.recipient_user_id === u.id);
  const latest = new Map<string, ConsentGrant>();
  for (const g of grants) if (!latest.has(g.citizen_id) || g.status === 'ACTIVE') latest.set(g.citizen_id, g);
  return [...latest.values()].map((g) => {
    const c = s.citizens.find((x) => x.id === g.citizen_id)!;
    return {
      citizen_id: c.id,
      full_name: c.full_name,
      full_name_ur: c.full_name_ur,
      cnic_masked: maskCnic(c.cnic_digits),
      avatar_color: c.avatar_color,
      district: c.district,
      active_case_count: s.cases.filter((x) => x.citizen_id === c.id && !['WITHDRAWN', 'CLOSED', 'PAID', 'REJECTED'].includes(x.status)).length,
      consent_status: g.status,
      consent_expires_at: g.expires_at,
      assurance_level: g.assurance_level,
    };
  });
});
on('POST', '/helper/families', (ctx, { body }) => {
  const u = requireRole(ctx, 'HELPER');
  const s = db();
  const b = body as { full_name: string; phone: string; district: string; cnic_digits?: string };
  const colors = ['#0F766E', '#9333EA', '#B45309', '#BE123C', '#15803D', '#0369A1', '#4338CA', '#7C2D12'];
  const c: MCitizen = { id: id('cit'), user_id: null, full_name: b.full_name, cnic_digits: b.cnic_digits ?? null, phone: b.phone, district: b.district, dob: null, avatar_color: colors[s.citizens.length % colors.length], profile: {}, created_by_user_id: u.id };
  s.citizens.push(c);
  audit({ ctx, action: 'helper.family_added', resource_type: 'citizen', resource_id: c.id });
  return { citizen_id: c.id, full_name: c.full_name, cnic_masked: maskCnic(c.cnic_digits), avatar_color: c.avatar_color, district: c.district, active_case_count: 0, consent_status: 'EXPIRED' };
});
on('POST', '/helper/families/:cid/consent-otp', (ctx, { params }) => {
  requireRole(ctx, 'HELPER');
  const s = db();
  const c = s.citizens.find((x) => x.id === params.cid);
  if (!c?.phone) throw E.notFound();
  const o = { id: id('otp'), phone: c.phone, code: String(Math.floor(100000 + Math.random() * 900000)), purpose: 'HELPER_CONSENT' as const, citizen_id: c.id, created_at: now(), consumed: false };
  s.otps.unshift(o);
  save();
  return { challenge_id: o.id, expires_in_sec: 300, simulated_sms_hint: 'Check Device Simulator inbox' };
});
on('POST', '/helper/families/:cid/consent-verify', (ctx, { params, body }) => {
  const u = requireRole(ctx, 'HELPER');
  const s = db();
  const b = body as { challenge_id?: string; code?: string; verbal_audio_id?: string; attested?: boolean };
  let level: 'CITIZEN_OTP' | 'VERBAL_WITNESSED' = 'CITIZEN_OTP';
  if (b.challenge_id) {
    const o = s.otps.find((x) => x.id === b.challenge_id && x.citizen_id === params.cid && !x.consumed);
    if (!o || o.code !== b.code) throw new HttpError(401, 'INVALID_OTP', 'Wrong or expired code.', 'کوڈ غلط یا پرانا ہے۔');
    o.consumed = true;
  } else if (b.verbal_audio_id && b.attested) level = 'VERBAL_WITNESSED';
  else throw E.validation({ consent: 'OTP or witnessed verbal consent required' });
  const g: ConsentGrant = {
    id: id('grant'),
    citizen_id: params.cid,
    recipient_type: 'HELPER',
    recipient_label: `Helper ${u.full_name}`,
    recipient_tenant_id: null,
    recipient_user_id: u.id,
    categories: ['IDENTITY', 'HOUSEHOLD', 'DOCUMENTS', 'CASE_HISTORY'],
    purposes: ['HELPER_ASSISTANCE', 'BENEFIT_APPLICATION'],
    status: 'ACTIVE',
    assurance_level: level,
    granted_at: now(),
    expires_at: new Date(Date.now() + 90 * 864e5).toISOString(),
    withdrawn_at: null,
  };
  s.grants.push(g);
  audit({ ctx, action: 'consent.granted', resource_type: 'consent_grant', resource_id: g.id, payload: { assurance: level } });
  return g;
});

// ======================= OFFICER =======================
on('GET', '/officer/queue', (ctx, { query }) => {
  const u = requireRole(ctx, 'OFFICER');
  const s = db();
  const sort = query.get('sort') ?? 'priority';
  const status = query.get('status');
  const assigned = query.get('assigned') ?? 'all';
  const flag = query.get('flag');
  let list = s.cases.filter((c) => c.tenant_id === u.tenant_id && ['HUMAN_REVIEW', 'IN_REVIEW', 'PENDING_SECOND_APPROVAL', 'PAYMENT_FAILED', 'ON_HOLD_CONSENT'].includes(c.status));
  if (status) list = list.filter((c) => c.status === status);
  if (assigned === 'me') list = list.filter((c) => c.assigned_officer_id === u.id);
  if (assigned === 'unassigned') list = list.filter((c) => !c.assigned_officer_id);
  if (flag) list = list.filter((c) => c.flags.some((f) => f.code === flag || f.severity === flag));
  const waitH = (c: MCase) => (Date.now() - new Date(c.submitted_at ?? c.created_at).getTime()) / 36e5;
  for (const c of list) {
    if (c.status === 'HUMAN_REVIEW' || c.status === 'IN_REVIEW') {
      const p = priority(c.facts, c.flags, waitH(c));
      c.priority_score = Math.max(c.priority_score, p.score);
      c.priority_band = c.priority_score >= 80 ? 'URGENT' : c.priority_score >= 60 ? 'HIGH' : c.priority_score >= 35 ? 'NORMAL' : 'LOW';
    }
  }
  list.sort((a, b) =>
    sort === 'confidence_asc' ? (a.latest_confidence ?? 1) - (b.latest_confidence ?? 1) : sort === 'oldest' ? (a.submitted_at ?? '').localeCompare(b.submitted_at ?? '') : b.priority_score - a.priority_score,
  );
  const program = (c: MCase) => s.programs.find((p) => p.id === c.program_id)!;
  const cards: QueueCard[] = list.map((c) => {
    const consentOk = s.grants.some((g) => g.citizen_id === c.citizen_id && g.recipient_type === 'DEPARTMENT' && g.recipient_tenant_id === c.tenant_id && g.status === 'ACTIVE');
    const cit = s.citizens.find((x) => x.id === c.citizen_id)!;
    const dec = [...s.decisions].reverse().find((d) => d.case_id === c.id);
    return {
      id: c.id,
      reference_code: c.reference_code,
      applicant_name: consentOk ? cit.full_name : 'Hidden — consent withdrawn',
      cnic_masked: consentOk ? maskCnic(cit.cnic_digits) ?? '—' : '—',
      status: c.status,
      priority_band: c.priority_band,
      priority_score: c.priority_score,
      latest_confidence: c.latest_confidence,
      latest_route: c.latest_route,
      reason_codes: dec?.escalation_reasons ?? c.flags.map((f) => f.code),
      flags: consentOk ? c.flags : [],
      submitted_at: c.submitted_at ?? c.created_at,
      assigned_officer: c.assigned_officer_id ? { id: c.assigned_officer_id, full_name: s.users.find((x) => x.id === c.assigned_officer_id)?.full_name ?? '' } : null,
      rule_stale: !!c.latest_rule_version_id && c.latest_rule_version_id !== program(c).active_rule_version_id,
      rule_version_number: s.ruleVersions.find((r) => r.id === c.latest_rule_version_id)?.version_number,
      ai_recommendation: c.latest_route === 'AUTO_APPROVE' ? 'Approve' : 'Human review',
    };
  });
  return page(cards, query);
});

on('POST', '/officer/cases/:id/assign', (ctx, { params }) => {
  const u = requireRole(ctx, 'OFFICER');
  const c = findCaseForStaff(ctx, params.id);
  enforce(ctx, c.citizen_id, 'CASE_HISTORY', `case:${c.reference_code}`, c.tenant_id);
  if (c.status === 'HUMAN_REVIEW') transition(c, 'IN_REVIEW');
  c.assigned_officer_id = u.id;
  tl(c, 'An officer is reviewing', 'افسر جائزہ لے رہا ہے');
  audit({ ctx, action: 'case.assigned', resource_type: 'case', resource_id: c.id });
  return detail(c, true);
});

on('POST', '/officer/cases/:id/decide', (ctx, { params, body }) => {
  const u = requireRole(ctx, 'OFFICER');
  const s = db();
  const c = findCaseForStaff(ctx, params.id);
  enforce(ctx, c.citizen_id, 'CASE_HISTORY', `case:${c.reference_code}`, c.tenant_id);
  const b = body as DecideRequest;
  if ((b.action === 'REJECT' || b.action === 'APPROVE') && c.flags.length && (!b.reason_codes.length || !b.note.trim()))
    throw E.validation({ reason_codes: 'At least one reason and a note are required', note: 'required' });
  if (b.action === 'REJECT' && (!b.reason_codes.length || !b.note.trim())) throw E.validation({ reason_codes: 'required', note: 'required' });
  const program = s.programs.find((p) => p.id === c.program_id)!;
  const rv = s.ruleVersions.find((r) => r.id === (c.latest_rule_version_id ?? program.active_rule_version_id))!;
  const amount = b.override_amount_pkr ?? (c.approved_amount_pkr || amountFor(c.facts, rv.rules_json));
  const high = c.flags.some((f) => f.severity === 'HIGH') || amount > rv.rules_json.policy.auto_approve_max_amount_pkr;
  let source: 'OFFICER' | 'SECOND_OFFICER' = 'OFFICER';

  if (b.action === 'APPROVE') {
    if (c.status === 'PENDING_SECOND_APPROVAL') {
      if (c.first_approver_id === u.id) {
        audit({ ctx, action: 'four_eyes.same_officer_blocked', resource_type: 'case', resource_id: c.id });
        throw new HttpError(403, 'SAME_OFFICER', 'A different officer must give the second approval.', 'دوسری منظوری کسی اور افسر کو دینی ہوگی۔');
      }
      source = 'SECOND_OFFICER';
      transition(c, 'APPROVED');
    } else if (high) {
      if (c.status === 'HUMAN_REVIEW') transition(c, 'IN_REVIEW');
      transition(c, 'PENDING_SECOND_APPROVAL');
      c.first_approver_id = u.id;
      c.assigned_officer_id = null;
      tl(c, 'Final check in progress', 'حتمی منظوری جاری ہے');
    } else {
      if (c.status === 'HUMAN_REVIEW') transition(c, 'IN_REVIEW');
      transition(c, 'APPROVED');
    }
    if (c.status === 'APPROVED') {
      c.approved_amount_pkr = amount;
      c.decided_at = now();
      c.citizen_explanation = {
        headline_ur: `آپ کی درخواست منظور ہو گئی ہے۔ ${new Intl.NumberFormat('en-PK').format(amount)} روپے بھیجے جا رہے ہیں۔`,
        headline_en: `Your application is approved. PKR ${new Intl.NumberFormat('en-PK').format(amount)} is being sent.`,
        reasons_ur: ['ایک افسر نے آپ کی معلومات کی تصدیق کی۔'],
        reasons_en: ['An officer checked and confirmed your information.'],
        next_step_ur: 'رقم آپ کے راسط نمبر پر بھیجی جائے گی اور تصدیقی کوڈ کے ساتھ پیغام ملے گا۔',
        next_step_en: 'Payment will be sent to your Raast number with a verification code SMS.',
      };
      tl(c, 'Approved by officer', 'افسر نے منظور کیا');
      schedulePayment(c.id);
    }
  } else if (b.action === 'REJECT') {
    if (c.status === 'HUMAN_REVIEW') transition(c, 'IN_REVIEW');
    transition(c, 'REJECTED');
    c.decided_at = now();
    c.citizen_explanation = {
      headline_ur: 'آپ کی درخواست منظور نہیں ہوئی۔',
      headline_en: 'Your application was not approved.',
      reasons_ur: [b.note],
      reasons_en: [b.note],
      next_step_ur: 'اگر آپ کو لگتا ہے کہ یہ غلط ہے تو مددگار یا دفتر سے رابطہ کریں۔',
      next_step_en: 'If you think this is wrong, contact a helper or the office.',
    };
    tl(c, 'Not approved', 'منظور نہیں ہوئی');
    notify(c, 'decision');
  } else if (b.action === 'REQUEST_INFO') {
    if (c.status === 'HUMAN_REVIEW') transition(c, 'IN_REVIEW');
    transition(c, 'NEEDS_INFO');
    c.citizen_explanation = {
      headline_ur: 'ہمیں آپ سے ایک اور چیز چاہیے۔',
      headline_en: 'We need one more thing from you.',
      reasons_ur: [b.note || 'براہ کرم مطلوبہ معلومات دیں۔'],
      reasons_en: [b.note || 'Please provide the requested information.'],
      next_step_ur: 'نیچے والا بٹن دبا کر یہ معلومات دیں۔',
      next_step_en: 'Tap the button below to add this information.',
    };
    tl(c, 'More information requested by officer', 'افسر نے مزید معلومات مانگی');
  } else {
    if (c.status === 'IN_REVIEW') transition(c, 'HUMAN_REVIEW');
    c.assigned_officer_id = null;
    c.priority_score = Math.min(100, c.priority_score + 15);
    tl(c, 'Escalated to senior officer', 'سینئر افسر کو بھیجا گیا');
  }
  const aiRoute = c.latest_route;
  // Override = officer outcome disagrees with what the engine would have done on its own.
  const isOverride = (b.action === 'REJECT' && (aiRoute === 'AUTO_APPROVE' || aiRoute === 'ASK_MORE')) || (b.action === 'APPROVE' && c.flags.some((f) => f.severity === 'HIGH'));
  s.decisions.push({
    id: id('dec'),
    tenant_id: c.tenant_id,
    case_id: c.id,
    decision_source: source,
    actor_user_id: u.id,
    rule_version_id: rv.id,
    rule_content_hash: rv.content_hash,
    rule_version_number: rv.version_number,
    input_snapshot_json: c.facts,
    input_snapshot_hash: sha256(JSON.stringify(c.facts)),
    rule_trace_json: c.rule_trace,
    confidence_components: c.confidence ?? { identity: 0, documents: 0, data_consistency: 0, consent_assurance: 0, overall: 0 },
    confidence_overall: c.latest_confidence ?? 0,
    route_action: c.latest_route ?? 'HUMAN_REVIEW',
    outcome_status: c.status,
    escalation_reasons: [],
    model_versions: { engine: '1.0.0' },
    citizen_explanation: c.citizen_explanation!,
    computed_amount_pkr: amount,
    officer_reason_codes: b.reason_codes,
    officer_note: b.note,
    is_override: isOverride,
    created_at: now(),
  });
  if (b.note) c.notes.push({ id: id('note'), note_type: 'OFFICER_NOTE', body: `${b.action}: ${b.note}`, author_label: u.full_name, is_visible_to_citizen: false, created_at: now() });
  audit({ ctx, action: `officer.${b.action.toLowerCase()}`, resource_type: 'case', resource_id: c.id, payload: { reason_codes: b.reason_codes, outcome: c.status, four_eyes: c.status === 'PENDING_SECOND_APPROVAL' } });
  return detail(c, true);
});

on('POST', '/officer/cases/:id/reevaluate', (ctx, { params }) => {
  requireRole(ctx, 'OFFICER');
  const s = db();
  const c = findCaseForStaff(ctx, params.id);
  enforce(ctx, c.citizen_id, 'CASE_HISTORY', `case:${c.reference_code}`, c.tenant_id);
  const program = s.programs.find((p) => p.id === c.program_id)!;
  const rv = s.ruleVersions.find((r) => r.id === program.active_rule_version_id)!;
  const trace = evaluate(c.facts, rv.rules_json);
  const amount = amountFor(c.facts, rv.rules_json);
  const d = route(trace, c.confidence!, c.flags, amount, rv.rules_json, c.ask_more_rounds, false);
  c.rule_trace = trace;
  c.latest_rule_version_id = rv.id;
  c.latest_route = d.action;
  c.approved_amount_pkr = d.outcome === 'APPROVED' ? amount : c.approved_amount_pkr;
  tl(c, `Re-evaluated with rule v${rv.version_number}`, `قاعدہ v${rv.version_number} سے دوبارہ جانچ`);
  audit({ ctx, action: 'case.reevaluated', resource_type: 'case', resource_id: c.id, payload: { rule_version: rv.version_number, route: d.action } });
  return detail(c, true);
});

on('POST', '/officer/cases/:id/notes', (ctx, { params, body }) => {
  const u = requireRole(ctx, 'OFFICER');
  const c = findCaseForStaff(ctx, params.id);
  const b = body as { body: string; is_visible_to_citizen: boolean };
  const n = { id: id('note'), note_type: 'OFFICER_NOTE' as const, body: b.body, author_label: u.full_name, is_visible_to_citizen: b.is_visible_to_citizen, created_at: now() };
  c.notes.push(n);
  audit({ ctx, action: 'case.note_added', resource_type: 'case', resource_id: c.id });
  return n;
});
on('GET', '/officer/corrections', (ctx) => {
  requireRole(ctx, 'OFFICER');
  return db().corrections.filter((c) => c.status === 'PENDING_OFFICER');
});
on('POST', '/officer/corrections/:id/resolve', (ctx, { params, body }) => {
  requireRole(ctx, 'OFFICER');
  const cr = db().corrections.find((c) => c.id === params.id);
  if (!cr) throw E.notFound();
  cr.status = (body as { decision: string }).decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  audit({ ctx, action: 'data.correction_resolved', resource_type: 'citizen', resource_id: cr.citizen_id, payload: { status: cr.status } });
  return cr;
});

// ======================= ADMIN: RULES =======================
function adminProgram(ctx: Ctx, programId: string) {
  const p = db().programs.find((x) => x.id === programId);
  if (!p || (ctx.user!.tenant_id && p.tenant_id !== ctx.user!.tenant_id)) throw E.notFound();
  return p;
}
on('GET', '/admin/programs/:pid/rules', (ctx, { params }) => {
  requireRole(ctx, 'ADMIN', 'AUDITOR');
  adminProgram(ctx, params.pid);
  return db().ruleVersions.filter((r) => r.program_id === params.pid).sort((a, b) => b.version_number - a.version_number);
});
on('POST', '/admin/programs/:pid/rules', (ctx, { params, body }) => {
  requireRole(ctx, 'ADMIN');
  const s = db();
  const p = adminProgram(ctx, params.pid);
  const active = s.ruleVersions.find((r) => r.id === p.active_rule_version_id)!;
  const rules = ((body as { rules_json?: RuleSet })?.rules_json ?? structuredClone(active.rules_json)) as RuleSet;
  const max = Math.max(...s.ruleVersions.filter((r) => r.program_id === p.id).map((r) => r.version_number));
  const rv = { id: id('rv'), program_id: p.id, version_number: max + 1, status: 'DRAFT' as const, rules_json: rules, content_hash: hashRules(rules), change_note: null, created_by: ctx.user!.full_name, published_by: null, published_at: null, created_at: now() };
  s.ruleVersions.push(rv);
  audit({ ctx, action: 'rule.draft_created', resource_type: 'rule_version', resource_id: rv.id, payload: { version: rv.version_number } });
  return rv;
});
on('PUT', '/admin/rules/:id', (ctx, { params, body }) => {
  requireRole(ctx, 'ADMIN');
  const rv = db().ruleVersions.find((r) => r.id === params.id);
  if (!rv) throw E.notFound();
  adminProgram(ctx, rv.program_id);
  if (rv.status !== 'DRAFT') throw new HttpError(409, 'RULE_VERSION_IMMUTABLE', 'Published rule versions cannot be edited.', 'شائع شدہ قاعدہ تبدیل نہیں ہو سکتا۔');
  rv.rules_json = (body as { rules_json: RuleSet }).rules_json;
  rv.content_hash = hashRules(rv.rules_json);
  audit({ ctx, action: 'rule.draft_updated', resource_type: 'rule_version', resource_id: rv.id, payload: { hash: rv.content_hash } });
  return rv;
});
on('POST', '/admin/rules/:id/validate', (ctx, { params }) => {
  requireRole(ctx, 'ADMIN');
  const rv = db().ruleVersions.find((r) => r.id === params.id);
  if (!rv) throw E.notFound();
  const errors = validateRules(rv.rules_json);
  return { valid: errors.length === 0, errors };
});
on('POST', '/admin/rules/:id/simulate', async (ctx, { params }) => {
  requireRole(ctx, 'ADMIN');
  const s = db();
  const rv = s.ruleVersions.find((r) => r.id === params.id);
  if (!rv) throw E.notFound();
  const p = adminProgram(ctx, rv.program_id);
  const base = s.ruleVersions.find((r) => r.id === p.active_rule_version_id)!;
  await delay(400);
  const result = twin(p.code === 'SAHARA_WIDOW_GRANT' ? s.history : [], base.rules_json, rv.rules_json);
  const simId = id('sim');
  audit({ ctx, action: 'rule.simulated', resource_type: 'rule_version', resource_id: rv.id, payload: { sample_size: result.sample_size, flipped: result.flipped_count, budget_delta_pkr: result.budget_delta_pkr } });
  return { simulation_id: simId, ...result };
});
on('POST', '/admin/rules/:id/publish', (ctx, { params, body }) => {
  requireRole(ctx, 'ADMIN');
  const s = db();
  const rv = s.ruleVersions.find((r) => r.id === params.id);
  if (!rv) throw E.notFound();
  const p = adminProgram(ctx, rv.program_id);
  const note = String((body as { change_note?: string })?.change_note ?? '').trim();
  if (!note) throw E.validation({ change_note: 'A change note is required to publish' });
  const errors = validateRules(rv.rules_json);
  if (errors.length) throw new HttpError(422, 'RULE_VALIDATION_FAILED', 'Rule draft is invalid.', 'قاعدے میں غلطیاں ہیں۔', { errors });
  const prev = s.ruleVersions.find((r) => r.id === p.active_rule_version_id);
  if (prev) prev.status = 'ARCHIVED';
  rv.status = 'PUBLISHED';
  rv.change_note = note;
  rv.published_by = ctx.user!.full_name;
  rv.published_at = now();
  p.active_rule_version_id = rv.id;
  s.jobs.unshift({ id: id('job'), job_type: 'REINDEX_RAG', status: 'COMPLETED', attempts: 1, max_attempts: 5, run_after: now(), last_error: null, payload_json: { program_id: p.id, rule_version: rv.version_number }, created_at: now() });
  audit({ ctx, action: 'rule.published', resource_type: 'rule_version', resource_id: rv.id, payload: { version: rv.version_number, hash: rv.content_hash, note } });
  return rv;
});

// ======================= ADMIN: USERS, KEYS, MOCKS, JOBS =======================
on('GET', '/admin/users', (ctx) => {
  const u = requireRole(ctx, 'ADMIN');
  return db().users.filter((x) => (u.tenant_id ? x.tenant_id === u.tenant_id : true) && x.role !== 'CITIZEN').map(publicUser);
});
on('POST', '/admin/users', (ctx, { body }) => {
  const u = requireRole(ctx, 'ADMIN');
  const b = body as { full_name: string; email: string; role: 'OFFICER' };
  const nu = { id: id('user'), role: b.role, full_name: b.full_name, email: b.email, phone: null, tenant_id: u.tenant_id, is_active: true, created_at: now() };
  db().users.push(nu);
  audit({ ctx, action: 'user.created', resource_type: 'user', resource_id: nu.id, payload: { role: b.role } });
  return publicUser(nu);
});
on('PATCH', '/admin/users/:id', (ctx, { params, body }) => {
  const admin = requireRole(ctx, 'ADMIN');
  const u = db().users.find((x) => x.id === params.id && (!admin.tenant_id || x.tenant_id === admin.tenant_id));
  if (!u) throw E.notFound();
  Object.assign(u, body);
  audit({ ctx, action: 'user.updated', resource_type: 'user', resource_id: u.id, payload: body as Record<string, unknown> });
  return publicUser(u);
});
on('GET', '/admin/api-keys', (ctx) => {
  requireRole(ctx, 'ADMIN');
  return db().apiKeys;
});
on('POST', '/admin/api-keys', (ctx, { body }) => {
  requireRole(ctx, 'ADMIN');
  const b = body as { name: string; scopes: string[]; rate_limit_per_min: number };
  const secret = `hq_live_${Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join('')}`;
  const k = { id: id('key'), name: b.name, key_prefix: secret.slice(0, 16), scopes: b.scopes, rate_limit_per_min: b.rate_limit_per_min, is_active: true, last_used_at: null, created_at: now() };
  db().apiKeys.unshift(k);
  audit({ ctx, action: 'api_key.created', resource_type: 'api_key', resource_id: k.id, payload: { scopes: b.scopes } });
  return { ...k, api_key: secret };
});
on('DELETE', '/admin/api-keys/:id', (ctx, { params }) => {
  requireRole(ctx, 'ADMIN');
  const k = db().apiKeys.find((x) => x.id === params.id);
  if (!k) throw E.notFound();
  k.is_active = false;
  audit({ ctx, action: 'api_key.revoked', resource_type: 'api_key', resource_id: k.id });
  return k;
});
on('GET', '/admin/mocks', (ctx) => {
  const u = requireRole(ctx, 'ADMIN');
  if (u.tenant_id) throw E.forbidden();
  return db().mockServices;
});
on('PATCH', '/admin/mocks', (ctx, { body }) => {
  const u = requireRole(ctx, 'ADMIN');
  if (u.tenant_id) throw E.forbidden();
  const b = body as { service_name: string; mode: 'NORMAL'; latency_ms?: number; failure_rate?: number };
  const m = db().mockServices.find((x) => x.service_name === b.service_name);
  if (!m) throw E.notFound();
  Object.assign(m, { mode: b.mode, latency_ms: b.latency_ms ?? m.latency_ms, failure_rate: b.failure_rate ?? m.failure_rate, updated_at: now() });
  audit({ ctx, action: 'mock.mode_changed', resource_type: 'mock_service', resource_id: m.service_name, payload: { mode: m.mode } });
  return m;
});
on('GET', '/admin/jobs', (ctx, { query }) => {
  requireRole(ctx, 'ADMIN');
  const st = query.get('status');
  return db().jobs.filter((j) => !st || j.status === st);
});
on('POST', '/admin/jobs/:id/retry', (ctx, { params }) => {
  requireRole(ctx, 'ADMIN');
  const j = db().jobs.find((x) => x.id === params.id);
  if (!j) throw E.notFound();
  j.status = 'PENDING';
  j.attempts = 0;
  audit({ ctx, action: 'job.retried', resource_type: 'job', resource_id: j.id });
  if (j.job_type === 'PROCESS_CASE') setTimeout(() => scheduleProcess(String(j.payload_json.case_id), 100), 100);
  return j;
});
on('POST', '/admin/demo/reset', (ctx) => {
  const u = requireRole(ctx, 'ADMIN');
  if (u.tenant_id) throw E.forbidden();
  resetState();
  return { ok: true };
});

// ======================= AUDITOR =======================
on('GET', '/auditor/events', (ctx, { query }) => {
  requireRole(ctx, 'AUDITOR');
  let ev = [...db().audit].reverse();
  const caseId = query.get('case_id');
  const actor = query.get('actor_type');
  const action = query.get('action');
  if (caseId) ev = ev.filter((e) => e.resource_id === caseId || String(e.payload_json.resource ?? '').includes(caseId));
  if (actor) ev = ev.filter((e) => e.actor_type === actor);
  if (action) ev = ev.filter((e) => e.action.includes(action));
  return page(ev, query);
});
on('GET', '/auditor/cases/:id/trace', (ctx, { params }) => {
  requireRole(ctx, 'AUDITOR');
  const s = db();
  const c = s.cases.find((x) => x.id === params.id || x.reference_code === params.id);
  if (!c) throw E.notFound();
  return {
    case_id: c.id,
    reference_code: c.reference_code,
    agent_steps: c.agent_steps,
    decisions: s.decisions
      .filter((d) => d.case_id === c.id)
      .map((d) => ({ ...d, actor_label: d.actor_user_id ? s.users.find((u) => u.id === d.actor_user_id)?.full_name : 'Decision engine' })),
  };
});
on('GET', '/auditor/consents', (ctx) => {
  requireRole(ctx, 'AUDITOR');
  const s = db();
  return { grants: s.grants, access_logs: s.accessLogs.slice(0, 200) };
});
on('GET', '/auditor/verify-chain', (ctx) => {
  requireRole(ctx, 'AUDITOR');
  return verifyChain();
});

// ======================= AI =======================
on('POST', '/voice/transcribe-parse', async (ctx, { form }) => {
  requireRole(ctx, 'CITIZEN', 'HELPER');
  await delay(900);
  const field = String(form?.get('field_key'));
  const sample: Record<string, [string, string | number, string, string]> = {
    applicant_full_name: ['فاطمہ بی بی', 'Fatima Bibi', 'آپ نے نام فاطمہ بی بی بتایا۔ کیا یہ درست ہے؟', 'You said Fatima Bibi. Is that correct?'],
    spouse_full_name: ['غلام رسول', 'Ghulam Rasool', 'آپ نے شوہر کا نام غلام رسول بتایا۔ کیا یہ درست ہے؟', 'You said Ghulam Rasool. Is that correct?'],
    applicant_cnic: ['نو نو نو صفر صفر ایک ...', '9990010000012', 'آپ نے شناختی کارڈ نمبر 99900-1000001-2 بتایا۔ کیا یہ درست ہے؟', 'You said 99900-1000001-2. Is that correct?'],
    applicant_dob: ['انیس سو چوہتر', '1974', 'آپ نے پیدائش کا سال 1974 بتایا۔ کیا یہ درست ہے؟', 'You said 1974. Is that correct?'],
    applicant_district: ['ٹھٹھہ', 'Thatta', 'آپ نے ضلع ٹھٹھہ بتایا۔ کیا یہ درست ہے؟', 'You said Thatta. Is that correct?'],
    children_under_18: ['تین', 3, 'آپ نے 3 بچے بتائے۔ کیا یہ درست ہے؟', 'You said 3 children. Is that correct?'],
    monthly_income_pkr: ['اٹھائیس ہزار روپے', 28000, 'آپ نے ماہانہ آمدنی اٹھائیس ہزار (28,000) روپے بتائی۔ کیا یہ درست ہے؟', 'You said PKR 28,000. Is that correct?'],
    spouse_cnic: ['نہیں معلوم', '', 'آپ نے بتایا کہ معلوم نہیں۔', "You said you don't know."],
  };
  const x = sample[field];
  if (!x) return { transcript: '', parsed_value: null, confidence: 0.2, readback_ur: '', readback_en: '', needs_retry: true };
  audit({ ctx, actor_type: 'AI', actor_id: 'whisper-1', action: 'ai.voice_parse', resource_type: 'field', resource_id: field, payload: { confidence: 0.91 } });
  return { transcript: x[0], parsed_value: x[1] === '' ? null : x[1], confidence: 0.91, readback_ur: x[2], readback_en: x[3], needs_retry: false, missing_reason: field === 'spouse_cnic' ? 'USER_UNKNOWN' : null };
});
on('POST', '/voice/tts', () => {
  throw E.unavailable('tts');
});

const RED_FLAGS: [string, RegExp, string, string, 'hard' | 'medium' | 'low'][] = [
  ['RF_ASKS_FEE', /(fee|fees|فیس|jama|جمع|bhej(en|o|ain)?\s*\d|send\s*rs|easy\s*paisa|easypaisa|jazz\s*cash|jazzcash|processing|registration)/i, 'Asks you to pay a fee', 'آپ سے فیس مانگی گئی ہے', 'hard'],
  ['RF_ASKS_PIN_OTP', /(pin|otp|mpin|password|code\s*bata|کوڈ\s*بتا|پن)/i, 'Asks for your PIN, OTP or password', 'آپ کا PIN یا OTP مانگا گیا ہے', 'hard'],
  ['RF_SUSPICIOUS_LINK', /(bit\.ly|tinyurl|https?:\/\/(?!haqdaar))/i, 'Contains a suspicious link', 'مشکوک لنک موجود ہے', 'medium'],
  ['RF_AMOUNT_MISMATCH', /(25[,.]?000|50[,.]?000|80[,.]?000)/, 'Amount does not match any real program amount', 'رقم کسی اصل پروگرام سے نہیں ملتی', 'medium'],
  ['RF_URGENCY_THREAT', /(aakhri|آخری|fori|فوری|block|بلاک|aaj hi|today only)/i, 'Pressures you to act fast', 'جلدی کرنے کا دباؤ ڈالا گیا ہے', 'low'],
  ['RF_PERSONAL_NUMBER', /(03\d{2}[-\s]?\d{7}|whatsapp\s*kar)/i, 'Asks you to contact a personal mobile number', 'ذاتی موبائل نمبر پر رابطے کا کہا گیا ہے', 'medium'],
];
on('POST', '/scam/check', async (ctx, { body, form }) => {
  const s = db();
  let text = (body as { text?: string } | null)?.text ?? '';
  if (form?.get('image')) text = 'Mubarak ho! Aap ki relief payment Rs 25,000 tayyar hai. Fori 500 rupay EasyPaisa fee bhejen 0345-1234567';
  if (form?.get('audio')) text = 'Aap ka Sahara package aa gaya hai, apna PIN code bata dein';
  await delay(500);
  const red_flags: ScamCheckResponse['red_flags'] = [];
  let verdict: ScamCheckResponse['verdict'];
  let confidence: number;
  let matched: ScamCheckResponse['matched_official'] = null;
  const code = text.match(/HQ-[0-9A-HJKMNP-TV-Z]{5}/i)?.[0]?.toUpperCase();
  if (code) {
    const n = s.notifications.find((x) => x.verification_code === code);
    const clean = (x: string) => x.replace(/\s+/g, ' ').trim();
    if (n && (clean(text) === clean(n.body_en) || clean(text) === clean(n.body_ur))) {
      verdict = 'VERIFIED_OFFICIAL';
      confidence = 0.99;
      matched = { verification_code: code, program: s.programs.find((p) => p.tenant_id === n.tenant_id)?.name, sent_at: n.created_at };
    } else {
      verdict = 'LIKELY_SCAM';
      confidence = 0.96;
      red_flags.push(
        n
          ? { code: 'RF_CODE_MISMATCH', label_en: 'The code is real but the message text was changed', label_ur: 'کوڈ اصلی ہے مگر پیغام بدلا گیا ہے' }
          : { code: 'RF_FAKE_CODE', label_en: 'This verification code was never sent by Haqdaar', label_ur: 'یہ تصدیقی کوڈ حقدار نے کبھی نہیں بھیجا' },
      );
    }
  } else {
    let hard = 0;
    let score = 0.12;
    for (const [c, re, en, ur, sev] of RED_FLAGS) {
      if (re.test(text)) {
        red_flags.push({ code: c, label_en: en, label_ur: ur });
        if (sev === 'hard') hard++;
        score += sev === 'hard' ? 0.35 : sev === 'medium' ? 0.18 : 0.08;
      }
    }
    if (/relief|imdad|امداد|package|پیکج|inaam|انعام|mubarak|مبارک/i.test(text)) score += 0.15;
    confidence = Math.min(0.97, score);
    verdict = hard >= 2 || score >= 0.75 ? 'LIKELY_SCAM' : text.trim().length < 15 || score >= 0.35 ? 'CANNOT_TELL' : 'LIKELY_SAFE';
    if (verdict === 'CANNOT_TELL') confidence = Math.max(0.4, Math.min(0.7, score));
    if (verdict === 'LIKELY_SAFE') confidence = 1 - score;
  }
  const check_id = id('scam');
  s.scamChecks.unshift({ id: check_id, verdict, disputed: false, created_at: now() });
  audit({ ctx, actor_type: 'AI', actor_id: 'scam-tfidf-lr-1.0', action: 'scam.checked', resource_type: 'scam_check', resource_id: check_id, payload: { verdict, flags: red_flags.map((f) => f.code) } });
  const copy: Record<string, [string, string, string, string]> = {
    VERIFIED_OFFICIAL: ['یہ پیغام حقدار نے بھیجا تھا اور اس میں کوئی تبدیلی نہیں ہوئی۔', 'This message was sent by Haqdaar and has not been changed.', 'پھر بھی کبھی PIN یا OTP نہ بتائیں۔', 'Even so, never share your PIN or OTP.'],
    LIKELY_SCAM: ['اس پیغام میں دھوکے کی نشانیاں ہیں۔', 'This message shows signs of a scam.', 'کوئی رقم نہ بھیجیں اور کوئی کوڈ نہ بتائیں۔ نمبر بلاک کر دیں۔', 'Do not send money or share any code. Block the number.'],
    CANNOT_TELL: ['ہم یقین سے نہیں کہہ سکتے کہ یہ اصلی ہے یا نہیں۔', 'We cannot tell for sure whether this is real.', 'احتیاط کریں: فیس نہ دیں، PIN نہ بتائیں، اور اصل کوڈ مانگیں۔', 'Be careful: pay no fee, share no PIN, ask for an official code.'],
    LIKELY_SAFE: ['اس پیغام میں دھوکے کی کوئی واضح نشانی نہیں ملی۔', 'We found no clear scam signs in this message.', 'پھر بھی کبھی PIN یا OTP نہ بتائیں۔', 'Still, never share your PIN or OTP.'],
  };
  const [eu, ee, au, ae] = copy[verdict];
  return { check_id, verdict, confidence: Math.round(confidence * 100) / 100, red_flags, matched_official: matched, explanation_ur: eu, explanation_en: ee, advice_ur: au, advice_en: ae };
});
on('POST', '/scam/:id/feedback', (ctx, { params }) => {
  const c = db().scamChecks.find((x) => x.id === params.id);
  if (c) c.disputed = true;
  audit({ ctx, action: 'scam.disputed', resource_type: 'scam_check', resource_id: params.id });
  return { ok: true };
});
on('POST', '/rag/ask', async (ctx, { body }) => {
  requireRole(ctx, 'CITIZEN', 'HELPER', 'OFFICER', 'ADMIN', 'AUDITOR');
  await delay(600);
  const b = body as { question: string; lang: 'ur' | 'en' };
  const s = db();
  const sahara = s.programs.find((p) => p.code === 'SAHARA_WIDOW_GRANT')!;
  const rv = s.ruleVersions.find((r) => r.id === sahara.active_rule_version_id)!;
  const ans = answerQuestion(b.question, b.lang, rv.rules_json, rv.version_number);
  audit({ ctx, actor_type: 'AI', actor_id: 'rag-hybrid-1.0', action: 'rag.asked', resource_type: 'rag', payload: { status: ans.status, top_score: ans.top_score } });
  return ans;
});
on('GET', '/eval/dashboard', (ctx) => {
  requireRole(ctx, 'ADMIN', 'AUDITOR', 'OFFICER');
  const s = db();
  return evalDashboard(s);
});
on('GET', '/analytics/tenant', (ctx) => {
  const u = requireRole(ctx, 'ADMIN', 'OFFICER', 'AUDITOR');
  const s = db();
  const tenantId = u.tenant_id ?? 'tenant-spd';
  const tenant = s.tenants.find((t) => t.id === tenantId)!;
  const list = s.cases.filter((c) => c.tenant_id === tenantId && c.case_type === 'BENEFIT_APPLICATION');
  const by: Partial<Record<CaseStatus, number>> = {};
  for (const c of list) by[c.status] = (by[c.status] ?? 0) + 1;
  const decided = list.filter((c) => c.decided_at);
  const approved = list.filter((c) => ['APPROVED', 'PAYMENT_INITIATED', 'PAID', 'PAYMENT_FAILED'].includes(c.status));
  const auto = s.decisions.filter((d) => d.tenant_id === tenantId && d.route_action === 'AUTO_APPROVE' && d.decision_source === 'AI_ENGINE').length;
  const flagCounts = new Map<string, number>();
  for (const c of list) for (const f of c.flags) flagCounts.set(f.code, (flagCounts.get(f.code) ?? 0) + 1);
  return {
    tenant: { code: tenant.code, name: tenant.name },
    cases_by_status: by,
    total_applications: list.length + (tenant.code === 'SPD' ? s.history.length : 0),
    auto_approve_pct: list.length ? auto / Math.max(1, s.decisions.filter((d) => d.tenant_id === tenantId).length) : 0,
    approval_rate: decided.length ? approved.length / decided.length : 0,
    avg_time_to_decision_hours: 0.4,
    disbursed_pkr: list.filter((c) => c.status === 'PAID').reduce((a, c) => a + (c.payment?.amount_pkr ?? c.approved_amount_pkr ?? 0), 0),
    top_flags: [...flagCounts.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
  };
});
on('GET', '/transparency', () => ({
  items: [],
  mock_services: db().mockServices.map((m) => ({ service_name: m.service_name, mode: m.mode })),
}));

// ======================= MOCK DPI: SMS inbox =======================
export function smsInbox(phone: string) {
  const s = db();
  const otps = s.otps
    .filter((o) => o.phone === phone)
    .map((o) => ({
      id: o.id,
      kind: 'OTP' as const,
      body_en: `Haqdaar (simulated): your code is ${o.code}. Never share it with anyone.`,
      body_ur: `حقدار (نقلی): آپ کا کوڈ ${o.code} ہے۔ کسی کو نہ بتائیں۔`,
      verification_code: null,
      created_at: o.created_at,
    }));
  const notes = s.notifications.filter((n) => n.phone === phone).map((n) => ({ id: n.id, kind: 'NOTIFICATION' as const, body_en: n.body_en, body_ur: n.body_ur, verification_code: n.verification_code, created_at: n.created_at }));
  return { simulated: true, service_mode: s.mockServices.find((m) => m.service_name === 'sms')?.mode, phone, messages: [...otps, ...notes].sort((a, b) => b.created_at.localeCompare(a.created_at)) };
}

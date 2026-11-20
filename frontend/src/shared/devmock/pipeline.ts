import type { AgentStep, ConsentGrant, Flag, TimelineItem } from '../api/types';
import { audit, db, save } from './core';
import { amountFor, evaluate, explain, known, overallConfidence, priority, route, unknown, type Facts } from './engine';
import type { MCase, MNotification } from './state';
import { canonical, id, now, sha256, verificationCode } from './util';

// Simulated PROCESS_CASE / INITIATE_PAYMENT / CHECK_COMPLAINT jobs (docs/06, F-05, F-09).

const t = (en: string, ur: string): TimelineItem => ({ at: now(), label_en: en, label_ur: ur });

function serviceMode(name: string) {
  return db().mockServices.find((s) => s.service_name === name)?.mode ?? 'NORMAL';
}

/** Call a simulated registry with FLAKY retries; returns false when it stays unavailable. */
function callService(name: string): { ok: boolean; ms: number; retried: boolean } {
  const cfg = db().mockServices.find((s) => s.service_name === name);
  const mode = cfg?.mode ?? 'NORMAL';
  if (mode === 'DOWN') return { ok: false, ms: 5, retried: true };
  if (mode === 'FLAKY') {
    for (let i = 0; i < 3; i++) if (Math.random() > (cfg?.failure_rate ?? 0.5)) return { ok: true, ms: (cfg?.latency_ms ?? 4000) / 4, retried: i > 0 };
    return { ok: false, ms: 900, retried: true };
  }
  return { ok: true, ms: mode === 'SLOW' ? cfg?.latency_ms ?? 4000 : 30 + Math.round(Math.random() * 50), retried: false };
}

function canon(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !['mst', 'musammat', 'bibi', 'bano', 'begum', 'mrs', 'mr', 'syed', 'haji'].includes(w))
    .map((w) => (/^(muhammad|mohammad|muhammed|mohammed|mohd|md)$/.test(w) ? 'muhammad' : /^(fatima|fatimah|fatma)$/.test(w) ? 'fatima' : w))
    .join(' ')
    .trim();
}

/** Jaro-Winkler on canonical names (simplified port of engine/entity_resolution.py). */
export function nameSim(a: string, b: string): number {
  const s1 = canon(a) || a.toLowerCase();
  const s2 = canon(b) || b.toLowerCase();
  if (s1 === s2) return 1;
  const range = Math.max(0, Math.floor(Math.max(s1.length, s2.length) / 2) - 1);
  const m1 = new Array(s1.length).fill(false);
  const m2 = new Array(s2.length).fill(false);
  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(s2.length, i + range + 1); j++) {
      if (!m2[j] && s1[i] === s2[j]) {
        m1[i] = m2[j] = true;
        matches++;
        break;
      }
    }
  }
  if (!matches) return 0;
  let k = 0;
  let trans = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!m1[i]) continue;
    while (!m2[k]) k++;
    if (s1[i] !== s2[k]) trans++;
    k++;
  }
  const jaro = (matches / s1.length + matches / s2.length + (matches - trans / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && s1[prefix] === s2[prefix]) prefix++;
  return Math.round((jaro + prefix * 0.1 * (1 - jaro)) * 1000) / 1000;
}

function activeDeptGrant(c: MCase): ConsentGrant | undefined {
  return db().grants.find((g) => g.citizen_id === c.citizen_id && g.recipient_type === 'DEPARTMENT' && g.recipient_tenant_id === c.tenant_id && g.status === 'ACTIVE');
}

export function scheduleProcess(caseId: string, delayMs = 1200) {
  db().jobs.unshift({
    id: id('job'),
    job_type: 'PROCESS_CASE',
    status: 'PENDING',
    attempts: 0,
    max_attempts: 5,
    run_after: new Date(Date.now() + delayMs).toISOString(),
    last_error: null,
    payload_json: { case_id: caseId },
    created_at: now(),
  });
  save();
  setTimeout(() => processCase(caseId), delayMs);
}

export function processCase(caseId: string) {
  const s = db();
  const c = s.cases.find((x) => x.id === caseId);
  const job = s.jobs.find((j) => j.job_type === 'PROCESS_CASE' && j.payload_json.case_id === caseId && (j.status === 'PENDING' || j.status === 'FAILED_RETRY'));
  if (!c || !['SUBMITTED', 'WAITING_EXTERNAL'].includes(c.status)) {
    if (job) job.status = 'COMPLETED';
    return;
  }
  if (job) {
    job.status = 'RUNNING';
    job.attempts += 1;
  }
  if (!activeDeptGrant(c)) {
    c.previous_status = c.status;
    c.status = 'ON_HOLD_CONSENT';
    c.timeline.push(t('Paused: permission withdrawn', 'رکی ہوئی: اجازت واپس لی گئی'));
    if (job) job.status = 'COMPLETED';
    save();
    return;
  }
  c.status = 'PROCESSING';
  c.timeline.push(t('Checking with government records', 'سرکاری ریکارڈ سے جانچ'));
  audit({ actor_type: 'AGENT', actor_id: 'case_agent', action: 'case.processing', resource_type: 'case', resource_id: c.id, tenant_id: c.tenant_id });
  save();

  setTimeout(() => runAgent(c.id), 1400);
}

function runAgent(caseId: string) {
  const s = db();
  const c = s.cases.find((x) => x.id === caseId);
  if (!c || c.status !== 'PROCESSING') return;
  const program = s.programs.find((p) => p.id === c.program_id)!;
  const rv = s.ruleVersions.find((r) => r.id === program.active_rule_version_id)!;
  const rules = rv.rules_json;
  const a = c.draft_answers;
  const val = (k: string) => (a[k] && a[k].value !== null && a[k].value !== undefined ? a[k].value : null);
  const enteredBy = c.submitted_via_helper ? 'HELPER' : 'CITIZEN';
  const steps: AgentStep[] = [];
  const step = (tool: string, ok: boolean, ms: number, summary: string, retried = false) =>
    steps.push({ at: now(), tool, status: ok ? (retried ? 'RETRIED' : 'OK') : 'FAILED', duration_ms: Math.round(ms), summary });
  const flags: Flag[] = [];
  const facts: Facts = {};

  step('case.load', true, 11, 'Loaded draft answers and documents');
  const cnic = (val('applicant_cnic') as string | null) ?? null;
  const declaredName = String(val('applicant_full_name') ?? '');

  // Identity
  const idCall = callService('identity');
  if (!idCall.ok) return waitExternal(c, steps, 'identity', step);
  const person = cnic ? s.registry.find((p) => p.cnic === cnic) : undefined;
  let identityConf = 0.25;
  if (cnic) facts.applicant_cnic = known(cnic, 'SELF_DECLARED', 0.9, enteredBy);
  else facts.applicant_cnic = unknown('USER_UNKNOWN');
  if (person) {
    const sim = nameSim(declaredName, person.full_name);
    identityConf = sim >= 0.85 ? 0.98 : sim >= 0.7 ? 0.93 : sim >= 0.55 ? 0.75 : 0.3;
    if (sim < 0.55) flags.push({ code: 'IDENTITY_CONFLICT', severity: 'HIGH', detail: `Registry name "${person.full_name}" vs declared "${declaredName}" (similarity ${sim})` });
    else if (sim < 0.7) flags.push({ code: 'IDENTITY_NAME_VARIANT_CHECK', severity: 'MEDIUM', detail: `Name similarity ${sim}` });
    facts.applicant_full_name = { ...known(person.full_name, 'IDENTITY_REGISTRY', 0.98), alternatives: [{ value: declaredName, source: 'SELF_DECLARED', entered_by: enteredBy }] };
    facts.applicant_dob = known(person.dob, 'IDENTITY_REGISTRY', 0.98);
    facts.applicant_age_years = known(new Date().getFullYear() - Number(person.dob.slice(0, 4)), 'IDENTITY_REGISTRY', 0.98);
    facts.applicant_is_alive = known(person.is_alive, 'IDENTITY_REGISTRY', 0.99);
    facts.applicant_cnic_valid = known(person.cnic_expiry >= now().slice(0, 10), 'IDENTITY_REGISTRY', 0.99);
    if (!person.is_alive) flags.push({ code: 'APPLICANT_DECEASED', severity: 'HIGH' });
    step('identity.lookup', true, idCall.ms, `Exact CNIC match; "${declaredName}" vs registry "${person.full_name}" similarity ${sim} -> identity ${identityConf}`, idCall.retried);
  } else {
    facts.applicant_full_name = known(declaredName, 'SELF_DECLARED', 0.6, enteredBy);
    for (const k of ['applicant_dob', 'applicant_age_years', 'applicant_is_alive', 'applicant_cnic_valid']) facts[k] = unknown();
    if (cnic) flags.push({ code: 'CNIC_NOT_IN_REGISTRY', severity: 'HIGH', detail: 'CNIC not found in identity registry (simulated)' });
    step('identity.lookup', true, idCall.ms, cnic ? 'CNIC not found in registry - no guess made' : 'No CNIC - name search only, not auto-matched', idCall.retried);
  }
  facts.applicant_district = val('applicant_district') ? known(val('applicant_district'), 'SELF_DECLARED', 0.9, enteredBy) : unknown();

  // Civil registry
  const civil = callService('civil');
  if (!civil.ok) return waitExternal(c, steps, 'civil', step);
  const spouseCnic = val('spouse_cnic') as string | null;
  const death = s.deaths.find((d) => (cnic && d.spouse_cnic === cnic) || (spouseCnic && d.deceased_cnic === spouseCnic));
  const deathDoc = s.documents.find((d) => d.case_id === c.id && d.doc_type === 'SPOUSE_DEATH_CERTIFICATE');
  if (death) facts.spouse_death_verified = known(true, 'CIVIL_REGISTRY', 0.97);
  else if (deathDoc?.verify_status === 'VERIFIED') facts.spouse_death_verified = known(true, 'DOCUMENT_QR', 0.92);
  else facts.spouse_death_verified = unknown();
  facts.spouse_full_name = val('spouse_full_name') ? known(val('spouse_full_name'), 'SELF_DECLARED', 0.9, enteredBy) : unknown();
  facts.spouse_cnic = spouseCnic ? known(spouseCnic, 'SELF_DECLARED', 0.9, enteredBy) : unknown(a.spouse_cnic?.missing_reason ?? null);
  step('civil.death_records', true, civil.ms, death ? `Death record ${death.deceased_name} (${death.death_date}) linked to applicant` : 'No death record found; relying on certificate', civil.retried);

  // Household survey
  const hh = callService('household');
  if (!hh.ok) return waitExternal(c, steps, 'household', step);
  const survey = cnic ? s.households.find((x) => x.head_cnic === cnic) : undefined;
  const declaredIncome = val('monthly_income_pkr') as number | null;
  if (survey) {
    facts.monthly_income_pkr = known(survey.income, 'HOUSEHOLD_SURVEY', 0.92);
    if (declaredIncome !== null) {
      facts.monthly_income_pkr.alternatives = [{ value: declaredIncome, source: 'SELF_DECLARED', entered_by: enteredBy }];
      const diff = Math.abs(survey.income - declaredIncome);
      if (diff > 5000 && diff / Math.max(survey.income, 1) > 0.3) {
        facts.monthly_income_pkr.conflict = true;
        flags.push({ code: 'DATA_CONFLICT_INCOME', severity: 'MEDIUM', detail: `Self-declared PKR ${declaredIncome} vs survey PKR ${survey.income}` });
      }
    }
    facts.household_size = known(survey.size, 'HOUSEHOLD_SURVEY', 0.9);
    facts.poverty_score = known(survey.poverty, 'HOUSEHOLD_SURVEY', 0.9);
  } else {
    facts.monthly_income_pkr = declaredIncome !== null ? known(declaredIncome, 'SELF_DECLARED', 0.7, enteredBy) : unknown();
    facts.household_size = val('household_size') !== null ? known(val('household_size'), 'SELF_DECLARED', 0.7, enteredBy) : unknown();
    facts.poverty_score = unknown();
  }
  facts.children_under_18 = val('children_under_18') !== null ? known(val('children_under_18'), 'SELF_DECLARED', 0.9, enteredBy) : unknown();
  step('household.survey', true, hh.ms, survey ? `Survey income PKR ${survey.income}, size ${survey.size}` : 'No survey record; self-declared values used', hh.retried);

  // Benefits
  const ben = callService('benefits');
  if (!ben.ok) return waitExternal(c, steps, 'benefits', step);
  facts.has_conflicting_active_grant = known(!!(cnic && s.benefits.some((b) => b.cnic === cnic)), 'BENEFITS_REGISTRY', 0.95);
  step('benefits.active', true, ben.ms, 'No conflicting active benefit', ben.retried);

  // Documents
  const cnicDoc = s.documents.filter((d) => d.case_id === c.id && d.doc_type === 'CNIC_FRONT').pop();
  let docConf = 0.55;
  if (!cnicDoc) facts.cnic_doc_verified = unknown();
  else if (cnicDoc.verify_status === 'VERIFIED') {
    facts.cnic_doc_verified = known(true, 'DOCUMENT_VERIFIER', cnicDoc.verify_confidence ?? 0.95);
    docConf = cnicDoc.verify_confidence ?? 0.95;
  } else if (cnicDoc.verify_status === 'NEEDS_RETAKE') {
    facts.cnic_doc_verified = known(false, 'DOCUMENT_VERIFIER', 0.4);
    docConf = 0.4;
  } else if (cnicDoc.verify_status === 'TAMPER_SUSPECTED') {
    facts.cnic_doc_verified = known(false, 'DOCUMENT_VERIFIER', 0.1);
    docConf = 0.1;
    flags.push({ code: 'TAMPER_SUSPECTED', severity: 'HIGH' });
  } else facts.cnic_doc_verified = unknown();
  facts.death_cert_doc_verified = deathDoc ? known(deathDoc.verify_status === 'VERIFIED', 'DOCUMENT_VERIFIER', 0.9) : unknown(a.doc_SPOUSE_DEATH_CERTIFICATE?.missing_reason ?? null);
  facts.payout_phone = val('payout_phone') ? known(val('payout_phone'), 'SELF_DECLARED', 0.9, enteredBy) : unknown();
  step('documents.results', true, 6, cnicDoc ? `CNIC photo: ${cnicDoc.verify_status}` : 'No CNIC photo');

  // Anomalies
  const dup = s.cases.find((x) => x.id !== c.id && x.program_id === c.program_id && cnic && x.draft_answers.applicant_cnic?.value === cnic && !['WITHDRAWN', 'REJECTED', 'DRAFT'].includes(x.status));
  if (dup) flags.push({ code: 'DUPLICATE_APPLICATION', severity: 'HIGH', detail: `Also applied as ${dup.reference_code}` });
  const payout = facts.payout_phone.value;
  if (payout) {
    const others = new Set(s.cases.filter((x) => x.citizen_id !== c.citizen_id && x.draft_answers.payout_phone?.value === payout).map((x) => x.citizen_id));
    if (others.size >= 2) flags.push({ code: 'PAYOUT_ACCOUNT_SHARED', severity: 'HIGH', detail: `Payout alias used by ${others.size} other citizens` });
  }
  if (cnic && Number(cnic[12]) % 2 === 1 && program.code.includes('SAHARA')) flags.push({ code: 'CNIC_GENDER_MISMATCH', severity: 'LOW' });
  const helperGrant = c.submitted_via_helper ? s.grants.find((g) => g.citizen_id === c.citizen_id && g.recipient_type === 'HELPER' && g.status === 'ACTIVE') : undefined;
  if (helperGrant?.assurance_level === 'VERBAL_WITNESSED') flags.push({ code: 'LOW_ASSURANCE_CONSENT', severity: 'MEDIUM' });
  facts.citizen_has_active_dept_consent = known(true, 'CONSENT_ENGINE', 1);
  step('anomalies.check', true, 9, flags.length ? `Flags: ${flags.map((f) => f.code).join(', ')}` : 'No anomaly flags');

  // Confidence + rules + route
  let consistency = 0.98;
  for (const f of flags) {
    if (f.severity === 'LOW') consistency -= 0.05;
    if (f.severity === 'MEDIUM') consistency = Math.min(consistency, 0.72);
    if (f.severity === 'HIGH') consistency = Math.min(consistency, 0.2);
  }
  const conf = overallConfidence({
    identity: identityConf,
    documents: docConf,
    data_consistency: Math.round(consistency * 1000) / 1000,
    consent_assurance: helperGrant?.assurance_level === 'VERBAL_WITNESSED' ? 0.82 : 1,
  });
  const trace = evaluate(facts, rules);
  const amount = amountFor(facts, rules);
  step('rules.evaluate', true, 3, `Rule v${rv.version_number}: ${trace.filter((r) => r.result === 'PASS').length} pass, ${trace.filter((r) => r.result === 'FAIL').length} fail, ${trace.filter((r) => r.result === 'UNKNOWN').length} unknown`);
  const decision = route(trace, conf, flags, amount, rules, c.ask_more_rounds, false);
  step('router.route', true, 1, `${decision.action} (confidence ${conf.overall}, threshold ${rules.policy.auto_approve_confidence_threshold})`);

  const ex = explain(decision, trace, amount);
  const lowest = (Object.entries(conf) as [string, number][]).filter(([k]) => k !== 'overall').sort((x, y) => x[1] - y[1])[0];
  c.facts = facts;
  c.flags = flags;
  c.rule_trace = trace;
  c.confidence = conf;
  c.latest_confidence = conf.overall;
  c.latest_route = decision.action;
  c.latest_rule_version_id = rv.id;
  c.citizen_explanation = ex;
  c.agent_steps = [...c.agent_steps, ...steps];
  c.status = decision.outcome;
  c.updated_at = now();
  if (decision.outcome === 'NEEDS_INFO') c.ask_more_rounds += 1;
  if (decision.outcome === 'HUMAN_REVIEW') {
    const p = priority(facts, flags, 0);
    c.priority_score = p.score;
    c.priority_band = p.band;
    c.ai_case_note = {
      verified: trace.filter((r) => r.result === 'PASS').map((r) => `${r.rule_id}: ${r.reason_en}`),
      uncertain: [...decision.reasons, `Lowest pillar: ${lowest[0]} (${lowest[1]})`],
      suggested_checks: flags.length
        ? flags.map((f) => (f.code === 'TAMPER_SUSPECTED' ? 'Compare printed name on CNIC image against signed QR payload' : f.code === 'DATA_CONFLICT_INCOME' ? 'Ask applicant about income sources since the survey' : `Resolve ${f.code}`))
        : ['Confirm the lowest-confidence evidence with the applicant'],
      summary_en: `Routed to human: ${decision.reasons.join(', ')}`,
      summary_ur: 'انسانی جائزے کے لیے بھیجا گیا۔',
    };
  }
  c.timeline.push(
    decision.outcome === 'APPROVED'
      ? t('Approved automatically', 'خودکار طور پر منظور')
      : decision.outcome === 'NEEDS_INFO'
        ? t('More information requested', 'مزید معلومات درکار')
        : t('Sent to an officer for review', 'افسر کو جائزے کے لیے بھیجا گیا'),
  );
  if (decision.outcome === 'APPROVED') {
    c.approved_amount_pkr = amount;
    c.decided_at = now();
  }
  s.decisions.push({
    id: id('dec'),
    tenant_id: c.tenant_id,
    case_id: c.id,
    decision_source: 'AI_ENGINE',
    actor_user_id: null,
    rule_version_id: rv.id,
    rule_content_hash: rv.content_hash,
    rule_version_number: rv.version_number,
    input_snapshot_json: facts,
    input_snapshot_hash: sha256(canonical(facts)),
    rule_trace_json: trace,
    confidence_components: conf,
    confidence_overall: conf.overall,
    route_action: decision.action,
    outcome_status: decision.outcome,
    escalation_reasons: decision.reasons,
    model_versions: { engine: '1.0.0', doc_verify: 'cv-1.2', explainer: 'template-1.0', entity_resolution: 'rapidfuzz-jw-1.0' },
    citizen_explanation: ex,
    computed_amount_pkr: amount,
    officer_reason_codes: null,
    officer_note: null,
    is_override: false,
    created_at: now(),
  });
  for (const st of steps) audit({ actor_type: 'AGENT', actor_id: 'case_agent', action: 'agent.step', resource_type: 'case', resource_id: c.id, tenant_id: c.tenant_id, payload: { tool: st.tool, status: st.status, duration_ms: st.duration_ms } });
  audit({ actor_type: 'AI', actor_id: 'engine-1.0.0', action: 'decision.recorded', resource_type: 'case', resource_id: c.id, tenant_id: c.tenant_id, payload: { route: decision.action, confidence: conf.overall, rule_version: rv.version_number, reasons: decision.reasons } });
  const job = s.jobs.find((j) => j.job_type === 'PROCESS_CASE' && j.payload_json.case_id === c.id && j.status === 'RUNNING');
  if (job) job.status = 'COMPLETED';
  save();
  if (decision.outcome === 'APPROVED') schedulePayment(c.id);
}

function waitExternal(c: MCase, steps: AgentStep[], service: string, step: (tool: string, ok: boolean, ms: number, summary: string, retried?: boolean) => void) {
  const s = db();
  step(`${service}.lookup`, false, 900, `${service} registry unavailable after 2 retries - no guess made`, true);
  c.agent_steps = [...c.agent_steps, ...steps];
  if (c.status !== 'WAITING_EXTERNAL') c.timeline.push(t('Waiting for a government system', 'سرکاری نظام کا انتظار'));
  c.status = 'WAITING_EXTERNAL';
  c.latest_route = 'WAIT_EXTERNAL';
  c.citizen_explanation = explain({ action: 'WAIT_EXTERNAL', outcome: 'WAITING_EXTERNAL', reasons: [] }, [], 0);
  const job = s.jobs.find((j) => j.job_type === 'PROCESS_CASE' && j.payload_json.case_id === c.id && j.status === 'RUNNING');
  if (job) {
    job.status = job.attempts >= job.max_attempts ? 'DEAD' : 'FAILED_RETRY';
    job.last_error = `ExternalServiceUnavailable: ${service}`;
    job.run_after = new Date(Date.now() + 5000).toISOString();
  }
  audit({ actor_type: 'AGENT', actor_id: 'case_agent', action: 'case.waiting_external', resource_type: 'case', resource_id: c.id, tenant_id: c.tenant_id, payload: { service } });
  save();
  if (job?.status !== 'DEAD') setTimeout(() => processCase(c.id), 5000);
}

export function schedulePayment(caseId: string) {
  const s = db();
  s.jobs.unshift({ id: id('job'), job_type: 'INITIATE_PAYMENT', status: 'PENDING', attempts: 0, max_attempts: 5, run_after: now(), last_error: null, payload_json: { case_id: caseId }, created_at: now() });
  setTimeout(() => {
    const c = db().cases.find((x) => x.id === caseId);
    if (!c || c.status !== 'APPROVED') return;
    const alias = String(c.draft_answers.payout_phone?.value ?? c.facts.payout_phone?.value ?? '');
    c.status = 'PAYMENT_INITIATED';
    c.payment = { status: 'INITIATED', amount_pkr: c.approved_amount_pkr ?? 0, external_ref: null, failure_reason: null, payout_alias: alias };
    c.timeline.push(t('Sending payment (Raast, simulated)', 'رقم بھیجی جا رہی ہے'));
    save();
    setTimeout(() => {
      const cc = db().cases.find((x) => x.id === caseId);
      if (!cc || cc.status !== 'PAYMENT_INITIATED' || !cc.payment) return;
      const job = db().jobs.find((j) => j.job_type === 'INITIATE_PAYMENT' && j.payload_json.case_id === caseId);
      if (alias === '+923009999999' || serviceMode('payment') === 'DOWN') {
        cc.status = 'PAYMENT_FAILED';
        cc.payment = { ...cc.payment, status: 'FAILED', failure_reason: alias === '+923009999999' ? 'ACCOUNT_DORMANT' : 'PAYMENT_SERVICE_DOWN' };
        cc.timeline.push(t('Payment failed - officer notified', 'ادائیگی ناکام - افسر کو اطلاع'));
        if (job) {
          job.status = 'DEAD';
          job.last_error = cc.payment.failure_reason ?? null;
        }
      } else {
        cc.status = 'PAID';
        cc.payment = { ...cc.payment, status: 'COMPLETED', external_ref: `RAAST-${Math.floor(90000 + Math.random() * 9999)}` };
        cc.timeline.push(t('Money sent', 'رقم بھیج دی گئی'));
        if (job) job.status = 'COMPLETED';
        notify(cc, 'payment');
      }
      audit({ actor_type: 'SYSTEM', action: cc.status === 'PAID' ? 'payment.completed' : 'payment.failed', resource_type: 'payment', resource_id: cc.id, tenant_id: cc.tenant_id, payload: { amount_pkr: cc.payment.amount_pkr } });
      save();
    }, 1800);
  }, 1500);
}

export function notify(c: MCase, kind: 'payment' | 'decision') {
  const s = db();
  const citizen = s.citizens.find((x) => x.id === c.citizen_id);
  const code = verificationCode();
  const amt = new Intl.NumberFormat('en-PK').format(c.payment?.amount_pkr ?? c.approved_amount_pkr ?? 0);
  const body_en =
    kind === 'payment'
      ? `Haqdaar: PKR ${amt} for ${c.reference_code} sent to your Raast number. Code ${code}. We never ask for a fee or PIN.`
      : `Haqdaar: update on ${c.reference_code}. Code ${code}.`;
  const body_ur =
    kind === 'payment'
      ? `حقدار: ${c.reference_code} کے ${amt} روپے آپ کے راسط نمبر پر بھیج دیے گئے۔ کوڈ ${code}۔ ہم کبھی فیس یا PIN نہیں مانگتے۔`
      : `حقدار: ${c.reference_code} کی تازہ صورتحال۔ کوڈ ${code}۔`;
  const n: MNotification = {
    id: id('ntf'),
    tenant_id: c.tenant_id,
    citizen_id: c.citizen_id,
    phone: citizen?.phone ?? null,
    channel: 'SMS_SIMULATED',
    title_en: kind === 'payment' ? 'Payment sent' : 'Application update',
    title_ur: kind === 'payment' ? 'رقم بھیج دی گئی' : 'درخواست کی تازہ صورتحال',
    body_en,
    body_ur,
    verification_code: code,
    body_sha256: sha256(body_en),
    case_id: c.id,
    read_at: null,
    created_at: now(),
  };
  s.notifications.unshift(n);
  audit({ actor_type: 'SYSTEM', action: 'notification.sent', resource_type: 'case', resource_id: c.id, tenant_id: c.tenant_id, payload: { verification_code: code, channel: n.channel } });
}

export function checkComplaint(complaint: MCase, parent: MCase) {
  setTimeout(() => {
    const failed = parent.payment?.status === 'FAILED';
    complaint.timeline.push(
      failed ? t('Payment failed - complaint filed with payment service', 'ادائیگی ناکام - شکایت درج') : t('Payment shows completed - officer will confirm with you', 'ادائیگی مکمل دکھائی دیتی ہے - افسر تصدیق کرے گا'),
    );
    complaint.status = 'HUMAN_REVIEW';
    complaint.priority_band = failed ? 'HIGH' : 'NORMAL';
    complaint.priority_score = failed ? 70 : 45;
    complaint.citizen_explanation = {
      headline_ur: failed ? 'ادائیگی ناکام ہوئی تھی۔ شکایت درج ہو گئی ہے۔' : 'ادائیگی مکمل دکھائی دیتی ہے۔ افسر آپ سے رابطہ کرے گا۔',
      headline_en: failed ? 'The payment had failed. A complaint has been filed.' : 'The payment shows as completed. An officer will contact you.',
      reasons_ur: failed ? ['ادائیگی نظام نے اکاؤنٹ کو غیر فعال بتایا۔'] : [],
      reasons_en: failed ? ['The payment system reported the account as dormant.'] : [],
      next_step_ur: 'افسر آپ سے نیا ادائیگی نمبر لے سکتا ہے۔',
      next_step_en: 'An officer may ask you for a new payout number.',
    };
    audit({ actor_type: 'AGENT', actor_id: 'complaint_agent', action: 'complaint.checked', resource_type: 'case', resource_id: complaint.id, tenant_id: complaint.tenant_id, payload: { payment_failed: failed, complaint_ref: failed ? `CMP-2026-${Math.floor(Math.random() * 900 + 100)}` : null } });
    save();
  }, 2000);
}

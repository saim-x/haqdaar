import type { ConfidenceComponents, Explanation, FactValue, Flag, RouteAction, RuleSet, RuleTraceItem, TwinOutcome, TwinResult } from '../api/types';

// TypeScript port of docs/06 (tri-state evaluator, weakest-link confidence,
// deterministic router, explainer, digital twin). Dev-mock only: the real
// engine is backend/app/engine/. Kept faithful so UI behaviour matches.

export const CANONICAL_FACTS: Record<string, 'string' | 'int' | 'bool'> = {
  applicant_cnic: 'string',
  applicant_full_name: 'string',
  applicant_dob: 'string',
  applicant_age_years: 'int',
  applicant_is_alive: 'bool',
  applicant_cnic_valid: 'bool',
  applicant_district: 'string',
  marital_status_widow: 'bool',
  spouse_death_verified: 'bool',
  spouse_full_name: 'string',
  spouse_cnic: 'string',
  children_under_18: 'int',
  household_size: 'int',
  monthly_income_pkr: 'int',
  poverty_score: 'int',
  has_conflicting_active_grant: 'bool',
  payout_phone: 'string',
  cnic_doc_verified: 'bool',
  death_cert_doc_verified: 'bool',
  citizen_has_active_dept_consent: 'bool',
};

export type Facts = Record<string, FactValue>;

export const known = (value: unknown, source: string, conf = 0.95, entered_by = 'SYSTEM'): FactValue => ({
  state: 'KNOWN',
  value,
  source,
  source_confidence: conf,
  entered_by,
  alternatives: [],
  conflict: false,
  missing_reason: null,
});
export const unknown = (missing_reason: string | null = null): FactValue => ({
  state: 'UNKNOWN',
  value: null,
  source: null,
  source_confidence: 0,
  entered_by: 'SYSTEM',
  alternatives: [],
  conflict: false,
  missing_reason,
});

function op(o: string, a: unknown, b: unknown): boolean {
  switch (o) {
    case 'eq':
      return a === b;
    case 'neq':
      return a !== b;
    case 'gt':
      return Number(a) > Number(b);
    case 'gte':
      return Number(a) >= Number(b);
    case 'lt':
      return Number(a) < Number(b);
    case 'lte':
      return Number(a) <= Number(b);
    case 'in':
      return Array.isArray(b) && b.includes(a);
    case 'not_in':
      return Array.isArray(b) && !b.includes(a);
    default:
      return false;
  }
}

export interface EvalRule extends RuleTraceItem {
  on_fail: 'HUMAN' | 'ASK';
  on_unknown: 'HUMAN' | 'ASK';
  ask_prompt_en: string | null;
  ask_prompt_ur: string | null;
}

export function evaluate(facts: Facts, rules: RuleSet): EvalRule[] {
  return rules.eligibility_rules.map((r) => {
    const f = facts[r.fact];
    const result: RuleTraceItem['result'] = !f || f.state === 'UNKNOWN' ? 'UNKNOWN' : op(r.op, f.value, r.value) ? 'PASS' : 'FAIL';
    return {
      rule_id: r.id,
      result,
      actual: f?.state === 'KNOWN' ? f.value : null,
      expected: `${r.op} ${JSON.stringify(r.value)}`,
      reason_en: result === 'PASS' ? r.pass_reason_en : result === 'FAIL' ? r.fail_reason_en : r.ask_prompt_en ?? r.fail_reason_en,
      reason_ur: result === 'PASS' ? r.pass_reason_ur : result === 'FAIL' ? r.fail_reason_ur : r.ask_prompt_ur ?? r.fail_reason_ur,
      label_en: r.label_en,
      on_fail: r.on_fail,
      on_unknown: r.on_unknown,
      ask_prompt_en: r.ask_prompt_en,
      ask_prompt_ur: r.ask_prompt_ur,
    };
  });
}

export function amountFor(facts: Facts, rules: RuleSet): number {
  const f = rules.benefit_formula;
  const kids = facts.children_under_18?.state === 'KNOWN' ? Number(facts.children_under_18.value) : 0;
  return Math.min(f.hard_cap_pkr, f.base_amount_pkr + Math.min(Math.max(0, kids), f.max_children_counted) * f.per_child_bonus_pkr);
}

export function overallConfidence(c: Omit<ConfidenceComponents, 'overall'>): ConfidenceComponents {
  return { ...c, overall: Math.round(Math.min(c.identity, c.documents, c.data_consistency, c.consent_assurance) * 1000) / 1000 };
}

export interface RouteDecision {
  action: RouteAction;
  outcome: 'APPROVED' | 'NEEDS_INFO' | 'HUMAN_REVIEW' | 'WAITING_EXTERNAL';
  reasons: string[];
}

export function route(trace: EvalRule[], conf: ConfidenceComponents, flags: Flag[], amount: number, rules: RuleSet, askRounds: number, externalDown: boolean): RouteDecision {
  const p = rules.policy;
  if (externalDown) return { action: 'WAIT_EXTERNAL', outcome: 'WAITING_EXTERNAL', reasons: ['EXTERNAL_SERVICE_UNAVAILABLE'] };
  const high = flags.filter((f) => f.severity === 'HIGH');
  if (high.length) return { action: 'HUMAN_REVIEW', outcome: 'HUMAN_REVIEW', reasons: high.map((f) => f.code) };
  const humanFails = trace.filter((r) => r.result === 'FAIL' && r.on_fail === 'HUMAN');
  if (humanFails.length) return { action: 'HUMAN_REVIEW', outcome: 'HUMAN_REVIEW', reasons: humanFails.map((r) => `RULE_FAIL_${r.rule_id}`) };
  const ask = trace.filter((r) => (r.result === 'UNKNOWN' && r.on_unknown === 'ASK') || (r.result === 'FAIL' && r.on_fail === 'ASK'));
  if (ask.length) {
    if (askRounds >= p.max_ask_more_rounds)
      return { action: 'HUMAN_REVIEW', outcome: 'HUMAN_REVIEW', reasons: ['MAX_ASK_ROUNDS_EXCEEDED', ...ask.map((r) => `MISSING_${r.rule_id}`)] };
    return { action: 'ASK_MORE', outcome: 'NEEDS_INFO', reasons: ask.map((r) => `ASK_${r.rule_id}`) };
  }
  const humanUnknown = trace.filter((r) => r.result === 'UNKNOWN' && r.on_unknown === 'HUMAN');
  if (humanUnknown.length) return { action: 'HUMAN_REVIEW', outcome: 'HUMAN_REVIEW', reasons: humanUnknown.map((r) => `UNKNOWN_${r.rule_id}`) };
  if (amount > p.auto_approve_max_amount_pkr) return { action: 'HUMAN_REVIEW', outcome: 'HUMAN_REVIEW', reasons: ['AMOUNT_EXCEEDS_AUTO_CAP'] };
  if (conf.overall < p.auto_approve_confidence_threshold) {
    const reasons = ['LOW_CONFIDENCE'];
    if (conf.consent_assurance < p.auto_approve_confidence_threshold) reasons.push('LOW_ASSURANCE_CONSENT');
    reasons.push(...flags.filter((f) => f.severity === 'MEDIUM').map((f) => f.code));
    return { action: 'HUMAN_REVIEW', outcome: 'HUMAN_REVIEW', reasons };
  }
  return { action: 'AUTO_APPROVE', outcome: 'APPROVED', reasons: [] };
}

export function explain(decision: RouteDecision, trace: EvalRule[], amount: number): Explanation {
  const fmt = new Intl.NumberFormat('en-PK').format(amount);
  switch (decision.outcome) {
    case 'APPROVED': {
      const pass = trace.filter((r) => r.result === 'PASS').slice(0, 3);
      return {
        headline_ur: `آپ کی درخواست منظور ہو گئی ہے۔ ${fmt} روپے بھیجے جا رہے ہیں۔`,
        headline_en: `Your application is approved. PKR ${fmt} is being sent.`,
        reasons_ur: pass.map((r) => r.reason_ur),
        reasons_en: pass.map((r) => r.reason_en),
        next_step_ur: 'رقم آپ کے راسط نمبر پر بھیجی جائے گی اور تصدیقی کوڈ کے ساتھ پیغام ملے گا۔',
        next_step_en: 'Payment will be sent to your Raast number with a verification code SMS.',
      };
    }
    case 'NEEDS_INFO': {
      const ask = trace.filter((r) => (r.result === 'UNKNOWN' && r.on_unknown === 'ASK') || (r.result === 'FAIL' && r.on_fail === 'ASK'));
      return {
        headline_ur: 'ہمیں آپ سے ایک اور چیز چاہیے۔',
        headline_en: 'We need one more thing from you.',
        reasons_ur: ask.map((r) => r.ask_prompt_ur ?? r.reason_ur).slice(0, 3),
        reasons_en: ask.map((r) => r.ask_prompt_en ?? r.reason_en).slice(0, 3),
        next_step_ur: 'نیچے والا بٹن دبا کر یہ معلومات دیں۔',
        next_step_en: 'Tap the button below to add this information.',
      };
    }
    case 'WAITING_EXTERNAL':
      return {
        headline_ur: 'ایک سرکاری تصدیقی نظام عارضی طور پر سست ہے۔',
        headline_en: 'A government verification system is temporarily slow.',
        reasons_ur: ['ہم نے سب کچھ محفوظ کر لیا ہے اور خود بخود دوبارہ کوشش کریں گے۔'],
        reasons_en: ['We saved everything and will continue automatically.'],
        next_step_ur: 'آپ کو کچھ کرنے کی ضرورت نہیں۔',
        next_step_en: 'You do not need to do anything.',
      };
    default:
      // Never accusatory, even when a tamper flag exists internally (docs/06 §8).
      return {
        headline_ur: 'ایک افسر آپ کی درخواست دیکھے گا — عام طور پر 2 دن میں۔',
        headline_en: 'An officer will review your application — usually within 2 days.',
        reasons_ur: ['کچھ معلومات کی انسانی تصدیق ضروری ہے۔'],
        reasons_en: ['Some information needs to be checked by a person.'],
        next_step_ur: 'آپ کو کچھ کرنے کی ضرورت نہیں۔ فیصلہ ہوتے ہی پیغام ملے گا۔',
        next_step_en: 'You do not need to do anything. You will get a message when it is decided.',
      };
  }
}

export function priority(facts: Facts, flags: Flag[], waitingHours: number): { score: number; band: 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW' } {
  let s = 30;
  if (facts.children_under_18?.state === 'KNOWN' && Number(facts.children_under_18.value) >= 3) s += 15;
  if (facts.monthly_income_pkr?.state === 'KNOWN' && Number(facts.monthly_income_pkr.value) <= 20000) s += 10;
  if (flags.some((f) => f.severity === 'HIGH')) s += 35;
  else if (flags.some((f) => f.severity === 'MEDIUM')) s += 15;
  s += Math.min(20, Math.round(waitingHours * 2));
  s = Math.min(100, s);
  return { score: s, band: s >= 80 ? 'URGENT' : s >= 60 ? 'HIGH' : s >= 35 ? 'NORMAL' : 'LOW' };
}

export interface HistoricalCase {
  case_id: string;
  reference_code: string;
  facts: Facts;
  flags: Flag[];
  confidence: ConfidenceComponents;
  ask_more_rounds: number;
}

export function twin(history: HistoricalCase[], baseline: RuleSet, candidate: RuleSet): TwinResult {
  const before: Record<TwinOutcome, number> = { APPROVED: 0, NEEDS_INFO: 0, HUMAN_REVIEW: 0 };
  const after: Record<TwinOutcome, number> = { APPROVED: 0, NEEDS_INFO: 0, HUMAN_REVIEW: 0 };
  const flipped: TwinResult['flipped_cases'] = [];
  let delta = 0;
  for (const h of history) {
    const run = (r: RuleSet) => {
      const tr = evaluate(h.facts, r);
      const amt = amountFor(h.facts, r);
      const d = route(tr, h.confidence, h.flags, amt, r, h.ask_more_rounds, false);
      return { outcome: d.outcome as TwinOutcome, amount: d.outcome === 'APPROVED' ? amt : null, reasons: d.reasons, trace: tr };
    };
    const b = run(baseline);
    const a = run(candidate);
    before[b.outcome] += 1;
    after[a.outcome] += 1;
    delta += (a.amount ?? 0) - (b.amount ?? 0);
    if (b.outcome !== a.outcome || b.amount !== a.amount) {
      const changedRule = a.trace.find((r, i) => r.result !== b.trace[i]?.result);
      flipped.push({
        case_id: h.case_id,
        reference_code: h.reference_code,
        before_route: b.outcome,
        after_route: a.outcome,
        before_amount: b.amount,
        after_amount: a.amount,
        primary_reason: changedRule
          ? `${changedRule.rule_id}: ${changedRule.result} (actual ${JSON.stringify(changedRule.actual)}, rule ${changedRule.expected})`
          : b.amount !== a.amount
            ? `Benefit formula changed amount ${b.amount ?? 0} -> ${a.amount ?? 0}`
            : a.reasons[0] ?? 'Route changed',
      });
    }
  }
  return { sample_size: history.length, before_counts: before, after_counts: after, flipped_count: flipped.length, flipped_cases: flipped, budget_delta_pkr: delta };
}

export function validateRules(r: RuleSet): { path: string; message: string }[] {
  const errors: { path: string; message: string }[] = [];
  const t = r.policy?.auto_approve_confidence_threshold;
  if (typeof t !== 'number' || t < 0.5 || t > 0.99) errors.push({ path: 'policy.auto_approve_confidence_threshold', message: 'Must be between 0.50 and 0.99' });
  if (!(r.policy?.auto_approve_max_amount_pkr > 0)) errors.push({ path: 'policy.auto_approve_max_amount_pkr', message: 'Must be positive' });
  const ids = new Set<string>();
  r.eligibility_rules.forEach((rule, i) => {
    const p = `eligibility_rules[${i}]`;
    if (!rule.id) errors.push({ path: `${p}.id`, message: 'Rule id is required' });
    if (ids.has(rule.id)) errors.push({ path: `${p}.id`, message: `Duplicate rule id ${rule.id}` });
    ids.add(rule.id);
    const type = CANONICAL_FACTS[rule.fact];
    if (!type) errors.push({ path: `${p}.fact`, message: `Unknown fact key "${rule.fact}"` });
    const vals = Array.isArray(rule.value) ? rule.value : [rule.value];
    if ((rule.op === 'in' || rule.op === 'not_in') && !Array.isArray(rule.value)) errors.push({ path: `${p}.value`, message: 'in / not_in need a list' });
    if (type === 'int' && vals.some((v) => typeof v !== 'number' || !Number.isFinite(v))) errors.push({ path: `${p}.value`, message: 'Value must be a number' });
    if (type === 'bool' && vals.some((v) => typeof v !== 'boolean')) errors.push({ path: `${p}.value`, message: 'Value must be true or false' });
    for (const k of ['label_en', 'label_ur', 'pass_reason_en', 'pass_reason_ur', 'fail_reason_en', 'fail_reason_ur'] as const) {
      if (!String(rule[k] ?? '').trim()) errors.push({ path: `${p}.${k}`, message: 'Explanation text is required (Urdu and English)' });
    }
    if ((rule.on_fail === 'ASK' || rule.on_unknown === 'ASK') && (!rule.ask_prompt_en?.trim() || !rule.ask_prompt_ur?.trim()))
      errors.push({ path: `${p}.ask_prompt_en`, message: 'ASK outcome needs an Urdu and English prompt' });
  });
  const f = r.benefit_formula;
  if (!(f.base_amount_pkr >= 0) || !(f.hard_cap_pkr >= f.base_amount_pkr)) errors.push({ path: 'benefit_formula', message: 'Cap must be >= base amount' });
  return errors;
}

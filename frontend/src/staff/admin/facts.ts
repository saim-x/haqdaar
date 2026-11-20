import type { RuleSet } from '../../shared/api/types';

// Canonical fact registry (docs/04 §5) — the rule editor only offers these keys.
export const FACTS: { key: string; type: 'string' | 'int' | 'bool'; label: string }[] = [
  { key: 'applicant_is_alive', type: 'bool', label: 'Applicant alive (identity registry)' },
  { key: 'applicant_cnic_valid', type: 'bool', label: 'CNIC not expired' },
  { key: 'applicant_age_years', type: 'int', label: 'Applicant age (years)' },
  { key: 'applicant_district', type: 'string', label: 'Applicant district' },
  { key: 'marital_status_widow', type: 'bool', label: 'Marital status: widow' },
  { key: 'spouse_death_verified', type: 'bool', label: 'Spouse death verified' },
  { key: 'children_under_18', type: 'int', label: 'Children under 18' },
  { key: 'household_size', type: 'int', label: 'Household size' },
  { key: 'monthly_income_pkr', type: 'int', label: 'Monthly household income (PKR)' },
  { key: 'poverty_score', type: 'int', label: 'Poverty score (0–100)' },
  { key: 'has_conflicting_active_grant', type: 'bool', label: 'Has conflicting active grant' },
  { key: 'cnic_doc_verified', type: 'bool', label: 'CNIC photo verified' },
  { key: 'death_cert_doc_verified', type: 'bool', label: 'Death certificate verified' },
  { key: 'applicant_cnic', type: 'string', label: 'Applicant CNIC' },
  { key: 'applicant_full_name', type: 'string', label: 'Applicant full name' },
  { key: 'applicant_dob', type: 'string', label: 'Applicant date of birth' },
  { key: 'spouse_full_name', type: 'string', label: 'Spouse full name' },
  { key: 'spouse_cnic', type: 'string', label: 'Spouse CNIC' },
  { key: 'payout_phone', type: 'string', label: 'Payout phone' },
  { key: 'citizen_has_active_dept_consent', type: 'bool', label: 'Active department consent' },
];

export const factType = (key: string) => FACTS.find((f) => f.key === key)?.type ?? 'string';

/** Human-readable list of what changed between two rule sets (shown before publishing). */
export function diffRules(a: RuleSet, b: RuleSet): string[] {
  const out: string[] = [];
  const num = (n: number) => new Intl.NumberFormat('en-PK').format(n);
  const pol = (k: keyof RuleSet['policy']) => {
    if (JSON.stringify(a.policy[k]) !== JSON.stringify(b.policy[k])) out.push(`Policy ${k}: ${JSON.stringify(a.policy[k])} → ${JSON.stringify(b.policy[k])}`);
  };
  (['auto_approve_confidence_threshold', 'auto_approve_max_amount_pkr', 'max_ask_more_rounds', 'cost_matrix'] as const).forEach(pol);
  for (const k of Object.keys(b.benefit_formula) as (keyof RuleSet['benefit_formula'])[]) {
    if (a.benefit_formula[k] !== b.benefit_formula[k]) out.push(`Benefit ${k}: ${num(a.benefit_formula[k])} → ${num(b.benefit_formula[k])}`);
  }
  const ids = new Set([...a.eligibility_rules.map((r) => r.id), ...b.eligibility_rules.map((r) => r.id)]);
  for (const id of ids) {
    const ra = a.eligibility_rules.find((r) => r.id === id);
    const rb = b.eligibility_rules.find((r) => r.id === id);
    if (!ra) out.push(`Added rule ${id}`);
    else if (!rb) out.push(`Removed rule ${id}`);
    else {
      if (JSON.stringify(ra.value) !== JSON.stringify(rb.value) || ra.op !== rb.op || ra.fact !== rb.fact)
        out.push(`${id}: ${ra.fact} ${ra.op} ${JSON.stringify(ra.value)} → ${rb.fact} ${rb.op} ${JSON.stringify(rb.value)}`);
      if (ra.on_fail !== rb.on_fail || ra.on_unknown !== rb.on_unknown) out.push(`${id}: outcomes ${ra.on_fail}/${ra.on_unknown} → ${rb.on_fail}/${rb.on_unknown}`);
      if (ra.label_en !== rb.label_en || ra.pass_reason_en !== rb.pass_reason_en || ra.pass_reason_ur !== rb.pass_reason_ur) out.push(`${id}: explanation text edited`);
    }
  }
  return out;
}

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { errorMessage } from '../../shared/api/errors';
import { pkr } from '../../shared/lib/money';
import type {
  Program,
  RuleCondition,
  RuleValidationResult,
  RuleVersion,
  RulesJson,
  RulesResponse,
  TwinResult,
} from '../../shared/api/types';
import {
  Card,
  CardTitle,
  Chip,
  ErrorState,
  factLabel,
  Loading,
  operatorWord,
  PageHeader,
  ruleStatusWord,
} from '../ui';

const FACT_KEYS = [
  'applicant_cnic',
  'applicant_full_name',
  'applicant_dob',
  'applicant_age_years',
  'applicant_is_alive',
  'applicant_cnic_valid',
  'applicant_district',
  'marital_status_widow',
  'spouse_death_verified',
  'spouse_full_name',
  'spouse_cnic',
  'children_under_18',
  'household_size',
  'monthly_income_pkr',
  'poverty_score',
  'has_conflicting_active_grant',
  'payout_phone',
  'cnic_doc_verified',
  'death_cert_doc_verified',
  'citizen_has_active_dept_consent',
];

const OPS = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in', 'not_in'];
const OUTCOMES = ['HUMAN', 'ASK'];

const INT_FACTS = new Set([
  'applicant_age_years',
  'children_under_18',
  'household_size',
  'monthly_income_pkr',
  'poverty_score',
]);

const BOOL_FACTS = new Set([
  'applicant_is_alive',
  'applicant_cnic_valid',
  'marital_status_widow',
  'spouse_death_verified',
  'has_conflicting_active_grant',
  'cnic_doc_verified',
  'death_cert_doc_verified',
  'citizen_has_active_dept_consent',
]);

function formatRuleValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (value === null || value === undefined) return '';
  return String(value);
}

function parseRuleValue(fact: string, op: string, raw: string): unknown {
  if (op === 'in' || op === 'not_in') {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (INT_FACTS.has(fact)) {
      return parts.map((p) => {
        const n = Number(p);
        return Number.isFinite(n) ? Math.trunc(n) : p;
      });
    }
    return parts;
  }
  const trimmed = raw.trim();
  if (BOOL_FACTS.has(fact)) {
    if (trimmed.toLowerCase() === 'true') return true;
    if (trimmed.toLowerCase() === 'false') return false;
  }
  if (INT_FACTS.has(fact) && trimmed !== '' && /^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }
  return raw;
}

/** DSL tokens stay in the payload; the editor shows the policy word. */
const OUTCOME_LABEL: Record<string, string> = {
  ASK: 'Ask for more',
  HUMAN: 'Human review',
};

function emptyCondition(): RuleCondition {
  return {
    id: `R${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    fact: 'monthly_income_pkr',
    op: 'lte',
    value: 40000,
    on_fail: 'HUMAN',
    on_unknown: 'ASK',
    label_en: 'Income threshold',
    label_ur: 'آمدنی کی حد',
    ask_prompt_en: 'Please confirm your monthly household income.',
    ask_prompt_ur: 'براہ کرم گھر کی ماہانہ آمدنی بتائیں۔',
    fail_reason_en: 'Monthly income exceeds the program limit.',
    fail_reason_ur: 'ماہانہ آمدنی پروگرام کی حد سے زیادہ ہے۔',
    pass_reason_en: 'Monthly income is within the program limit.',
    pass_reason_ur: 'ماہانہ آمدنی پروگرام کی حد کے اندر ہے۔',
    required_for_auto: true,
  };
}

/** A labelled console field. The label is a caption, never an uppercase tag. */
function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-meta text-ink-3">{label}</span>
      {children}
    </label>
  );
}

/**
 * Admin rule editor — docs/11 §6.2, AC-15.x.
 * Form-first: no JSON typing required. The JSON preview is read-only.
 *
 * A rule is a sentence: fact, operator, value, and what happens when the fact is
 * missing. So each rule is laid out as one line of that sentence, with the
 * bilingual labels underneath — reading a ruleset should feel like reading the
 * policy, not like reading a config file.
 */
export default function RulesPage() {
  const queryClient = useQueryClient();
  const [programId, setProgramId] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string>('');
  const [draft, setDraft] = useState<RulesJson | null>(null);
  const [changeNote, setChangeNote] = useState('');
  const [validation, setValidation] = useState<RuleValidationResult | null>(null);
  const [twin, setTwin] = useState<TwinResult | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger' | 'warn'; text: string } | null>(
    null,
  );

  const programs = useQuery({
    queryKey: ['programs'],
    queryFn: () => api.get<{ items: Program[] }>('/programs'),
  });

  useEffect(() => {
    if (!programId && programs.data?.items[0]) setProgramId(programs.data.items[0].id);
  }, [programs.data, programId]);

  const versions = useQuery({
    queryKey: ['rule-versions', programId],
    queryFn: () => api.get<RulesResponse>(`/admin/programs/${programId}/rules`),
    enabled: programId.length > 0,
  });

  useEffect(() => {
    if (!selectedId && versions.data?.versions[0]) {
      const first = versions.data.versions[0];
      setSelectedId(first.id);
      setDraft(first.rules_json);
    }
  }, [versions.data, selectedId]);

  const selected = useMemo(
    () => versions.data?.versions.find((v) => v.id === selectedId) ?? null,
    [versions.data, selectedId],
  );

  const readOnly = selected?.status !== 'DRAFT';

  const saveDraft = useMutation({
    mutationFn: () => api.put<RuleVersion>(`/admin/rules/${selectedId}`, { rules_json: draft }),
    onSuccess: () => {
      setMessage({ tone: 'ok', text: 'Draft saved.' });
      void queryClient.invalidateQueries({ queryKey: ['rule-versions', programId] });
    },
    onError: (err) => setMessage({ tone: 'danger', text: errorMessage(err, 'en') }),
  });

  const validate = useMutation({
    mutationFn: async () => {
      if (!readOnly && draft) {
        await api.put<RuleVersion>(`/admin/rules/${selectedId}`, { rules_json: draft });
      }
      return api.post<RuleValidationResult>(`/admin/rules/${selectedId}/validate`, {});
    },
    onSuccess: (res) => {
      setValidation(res);
      setMessage(
        res.valid
          ? {
              tone: 'ok',
              text: `Validation passed — ${res.rule_count ?? '?'} rules, hash ${res.content_hash?.slice(0, 12) ?? ''}…`,
            }
          : { tone: 'danger', text: `${res.errors.length} validation error(s).` },
      );
    },
    onError: (err) => setMessage({ tone: 'danger', text: errorMessage(err, 'en') }),
  });

  const simulate = useMutation({
    mutationFn: async () => {
      if (!readOnly && draft) {
        await api.put<RuleVersion>(`/admin/rules/${selectedId}`, { rules_json: draft });
      }
      return api.post<TwinResult>(`/admin/rules/${selectedId}/simulate`, { sample_size: 200 });
    },
    onSuccess: (res) => {
      setTwin(res);
      setMessage({ tone: 'ok', text: `Replayed ${res.sample_size} historical cases.` });
    },
    onError: (err) => setMessage({ tone: 'danger', text: errorMessage(err, 'en') }),
  });

  const publish = useMutation({
    mutationFn: () => api.post(`/admin/rules/${selectedId}/publish`, { change_note: changeNote }),
    onSuccess: () => {
      setMessage({ tone: 'ok', text: 'Published. The next evaluation uses this version immediately.' });
      setChangeNote('');
      void queryClient.invalidateQueries({ queryKey: ['rule-versions', programId] });
    },
    onError: (err) => setMessage({ tone: 'danger', text: errorMessage(err, 'en') }),
  });

  const createDraft = useMutation({
    mutationFn: () => api.post<RuleVersion>(`/admin/programs/${programId}/rules`, {}),
    onSuccess: (res) => {
      setSelectedId(res.id);
      setDraft(res.rules_json);
      setMessage({
        tone: 'ok',
        text: `Draft v${res.version_number} created from the active version.`,
      });
      void queryClient.invalidateQueries({ queryKey: ['rule-versions', programId] });
    },
    onError: (err) => setMessage({ tone: 'danger', text: errorMessage(err, 'en') }),
  });

  function updateRule(index: number, patch: Partial<RuleCondition>) {
    setDraft((prev) => {
      if (!prev) return prev;
      const eligibility_rules = prev.eligibility_rules.map((c, i) =>
        i === index ? { ...c, ...patch } : c,
      );
      return { ...prev, eligibility_rules };
    });
  }

  function addRule() {
    setDraft((prev) =>
      prev ? { ...prev, eligibility_rules: [...prev.eligibility_rules, emptyCondition()] } : prev,
    );
  }

  function removeRule(index: number) {
    setDraft((prev) =>
      prev
        ? { ...prev, eligibility_rules: prev.eligibility_rules.filter((_, i) => i !== index) }
        : prev,
    );
  }

  if (programs.isLoading) return <Loading />;
  if (programs.error) return <ErrorState error={programs.error} />;

  const activeId = versions.data?.active_rule_version_id ?? null;

  const messageSkin =
    message?.tone === 'ok'
      ? 'border-positive/25 bg-positive-wash text-positive'
      : message?.tone === 'warn'
        ? 'border-warn/25 bg-warn-wash text-warn'
        : 'border-negative/25 bg-negative-wash text-negative';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Rules & Digital Twin"
        subtitle="Publish a new version without a deploy. Published versions are immutable."
        actions={
          <>
            <select
              value={programId}
              aria-label="Program"
              onChange={(e) => {
                setProgramId(e.target.value);
                setSelectedId('');
                setDraft(null);
                setTwin(null);
              }}
              className="field w-auto"
            >
              {programs.data?.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => createDraft.mutate()}
              data-tour="rule-draft"
              disabled={createDraft.isPending || !programId}
              className="press min-h-[36px] rounded-control bg-accent px-3 text-caption font-medium text-white hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-45"
            >
              New draft
            </button>
          </>
        }
      />

      {message && (
        <div
          role="status"
          className={`rounded-control border px-4 py-2.5 text-caption font-medium ${messageSkin}`}
        >
          {message.text}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[264px_minmax(0,1fr)]">
        <Card className="h-fit p-0">
          <div className="flex items-baseline justify-between gap-2 border-b border-ink/[0.08] px-4 py-3">
            <h2 className="text-body font-medium text-ink">Version history</h2>
            <span className="num text-meta text-ink-3">
              {versions.data?.versions.length ?? 0}
            </span>
          </div>
          <ul>
            {versions.data?.versions.map((v) => {
              const isSelected = selectedId === v.id;
              return (
                <li key={v.id} className="border-b border-ink/[0.06] last:border-b-0">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(v.id);
                      setDraft(v.rules_json);
                      setValidation(null);
                      setTwin(null);
                    }}
                    className={`press w-full px-4 py-2.5 text-start ${
                      isSelected ? 'row-active' : 'hover:bg-raised'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="num font-mono text-caption font-medium text-ink">
                        v{v.version_number}
                      </span>
                      <Chip
                        tone={
                          v.status === 'PUBLISHED' ? 'ok' : v.status === 'DRAFT' ? 'warn' : 'neutral'
                        }
                      >
                        {ruleStatusWord(v.status)}
                      </Chip>
                      {v.id === activeId && <Chip tone="ok">active</Chip>}
                    </span>
                    <span className="mt-1 block truncate font-mono text-meta text-ink-3">
                      {v.content_hash.replace(/^sha256:/, '').slice(0, 12)}…
                    </span>
                    {v.change_note && (
                      <span className="mt-0.5 block truncate text-meta text-ink-2">
                        {v.change_note}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        <div className="space-y-4">
          {!draft && (
            <Card>
              <p className="text-caption text-ink-3">
                Select a version to edit, or create a new draft.
              </p>
            </Card>
          )}

          {draft && (
            <>
              <Card>
                <CardTitle
                  hint={readOnly ? 'read-only — published versions are immutable' : 'form editor'}
                >
                  Eligibility rules
                </CardTitle>

                <div className="space-y-3">
                  {draft.eligibility_rules.map((rule, index) => (
                    <div
                      key={rule.id}
                      className="rounded-control border border-ink/[0.10] bg-card p-3"
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <span className="font-mono text-meta font-medium text-accent-ink">
                          {rule.id}
                        </span>
                        {rule.required_for_auto && (
                          <span className="text-meta text-ink-3">required for auto</span>
                        )}
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => removeRule(index)}
                            className="press ms-auto rounded-[6px] px-1.5 py-0.5 text-meta text-negative hover:bg-negative-wash"
                          >
                            Remove
                          </button>
                        )}
                      </div>

                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1.9fr)_auto_minmax(0,1.2fr)_minmax(0,0.75fr)_minmax(0,0.75fr)]">
                        <Field label="Fact">
                          <select
                            value={rule.fact}
                            disabled={readOnly}
                            title={rule.fact}
                            onChange={(e) => updateRule(index, { fact: e.target.value })}
                            className="field w-full"
                          >
                            {FACT_KEYS.map((k) => (
                              <option key={k} value={k}>
                                {factLabel(k)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Operator">
                          <select
                            value={rule.op}
                            disabled={readOnly}
                            title={rule.op}
                            onChange={(e) => updateRule(index, { op: e.target.value })}
                            className="field w-full"
                          >
                            {OPS.map((o) => (
                              <option key={o} value={o}>
                                {operatorWord(o)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Value">
                          <input
                            value={formatRuleValue(rule.value)}
                            title={formatRuleValue(rule.value)}
                            disabled={readOnly}
                            onChange={(e) =>
                              updateRule(index, {
                                value: parseRuleValue(rule.fact, rule.op, e.target.value),
                              })
                            }
                            className="field num w-full font-mono"
                          />
                        </Field>
                        <Field label="On fail">
                            <select
                              value={rule.on_fail}
                              disabled={readOnly}
                              onChange={(e) => updateRule(index, { on_fail: e.target.value })}
                              className="field w-full font-mono"
                            >
                              {OUTCOMES.map((o) => (
                                <option key={o} value={o}>
                                  {OUTCOME_LABEL[o] ?? o}
                                </option>
                              ))}
                            </select>
                        </Field>
                        <Field label="On unknown">
                            <select
                              value={rule.on_unknown}
                              disabled={readOnly}
                              onChange={(e) => updateRule(index, { on_unknown: e.target.value })}
                              className="field w-full font-mono"
                            >
                              {OUTCOMES.map((o) => (
                                <option key={o} value={o}>
                                  {OUTCOME_LABEL[o] ?? o}
                                </option>
                              ))}
                            </select>
                        </Field>
                      </div>

                      <div className="mt-2 grid gap-2 border-t border-ink/[0.06] pt-2 sm:grid-cols-2">
                        <Field label="Label (English)">
                          <input
                            value={rule.label_en}
                            disabled={readOnly}
                            onChange={(e) => updateRule(index, { label_en: e.target.value })}
                            className="field w-full"
                          />
                        </Field>
                        <Field label="Label (اردو)">
                          <input
                            dir="rtl"
                            value={rule.label_ur}
                            disabled={readOnly}
                            onChange={(e) => updateRule(index, { label_ur: e.target.value })}
                            className="field w-full"
                          />
                        </Field>
                        <Field label="Fail reason (English)">
                          <input
                            value={rule.fail_reason_en}
                            disabled={readOnly}
                            onChange={(e) => updateRule(index, { fail_reason_en: e.target.value })}
                            className="field w-full"
                          />
                        </Field>
                        <Field label="Fail reason (اردو)">
                          <input
                            dir="rtl"
                            value={rule.fail_reason_ur}
                            disabled={readOnly}
                            onChange={(e) => updateRule(index, { fail_reason_ur: e.target.value })}
                            className="field w-full"
                          />
                        </Field>
                        <Field label="Pass reason (English)">
                          <input
                            value={rule.pass_reason_en ?? ''}
                            disabled={readOnly}
                            onChange={(e) => updateRule(index, { pass_reason_en: e.target.value })}
                            className="field w-full"
                          />
                        </Field>
                        <Field label="Pass reason (اردو)">
                          <input
                            dir="rtl"
                            value={rule.pass_reason_ur ?? ''}
                            disabled={readOnly}
                            onChange={(e) => updateRule(index, { pass_reason_ur: e.target.value })}
                            className="field w-full"
                          />
                        </Field>
                        {rule.on_unknown === 'ASK' && (
                          <>
                            <Field label="Ask prompt (English)">
                              <input
                                value={rule.ask_prompt_en ?? ''}
                                disabled={readOnly}
                                onChange={(e) => updateRule(index, { ask_prompt_en: e.target.value })}
                                className="field w-full"
                              />
                            </Field>
                            <Field label="Ask prompt (اردو)">
                              <input
                                dir="rtl"
                                value={rule.ask_prompt_ur ?? ''}
                                disabled={readOnly}
                                onChange={(e) => updateRule(index, { ask_prompt_ur: e.target.value })}
                                className="field w-full"
                              />
                            </Field>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {!readOnly && (
                  <button
                    type="button"
                    onClick={addRule}
                    className="press mt-3 min-h-[32px] rounded-[7px] border border-dashed border-ink/[0.18] px-3 text-meta text-ink-2 hover:border-accent/40 hover:bg-accent-wash hover:text-accent-ink"
                  >
                    Add rule
                  </button>
                )}
              </Card>

              <Card>
                <CardTitle>Benefit formula & threshold</CardTitle>
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  {(
                    [
                      ['base_amount_pkr', 'Base PKR'],
                      ['per_child_bonus_pkr', 'Per child PKR'],
                      ['max_children_counted', 'Max children'],
                      ['hard_cap_pkr', 'Hard cap PKR'],
                    ] as const
                  ).map(([key, label]) => (
                    <Field key={key} label={label}>
                      <input
                        type="number"
                        value={draft.benefit_formula[key]}
                        disabled={readOnly}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  benefit_formula: {
                                    ...prev.benefit_formula,
                                    [key]: Number(e.target.value),
                                  },
                                }
                              : prev,
                          )
                        }
                        className="field num w-full font-mono"
                      />
                    </Field>
                  ))}
                  <Field label="Auto-approve threshold">
                    <input
                      type="number"
                      step="0.01"
                      min="0.5"
                      max="0.99"
                      value={draft.policy.auto_approve_confidence_threshold}
                      disabled={readOnly}
                      onChange={(e) =>
                        setDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                policy: {
                                  ...prev.policy,
                                  auto_approve_confidence_threshold: Number(e.target.value),
                                },
                              }
                            : prev,
                        )
                      }
                      className="field num w-full font-mono"
                    />
                  </Field>
                  <Field label="Auto-approve max PKR">
                    <input
                      type="number"
                      value={draft.policy.auto_approve_max_amount_pkr}
                      disabled={readOnly}
                      onChange={(e) =>
                        setDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                policy: {
                                  ...prev.policy,
                                  auto_approve_max_amount_pkr: Number(e.target.value),
                                },
                              }
                            : prev,
                        )
                      }
                      className="field num w-full font-mono"
                    />
                  </Field>
                </div>
              </Card>

              <Card>
                <CardTitle hint="read-only">JSON preview</CardTitle>
                <pre className="max-h-64 overflow-auto rounded-control border border-ink/[0.08] bg-raised p-3 font-mono text-meta leading-[1.6] text-ink-2">
                  {JSON.stringify(draft, null, 2)}
                </pre>
              </Card>

              {validation && !validation.valid && (
                <Card className="border-negative/25 bg-negative-wash">
                  <CardTitle>Validation errors</CardTitle>
                  <ul className="space-y-1">
                    {validation.errors.map((err) => (
                      <li key={`${err.field}-${err.message_en}`} className="text-caption">
                        <span className="font-mono text-negative">{err.field}</span>
                        <span className="text-ink">: {err.message_en}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              {twin && (
                <Card className="p-0">
                  <div className="flex items-baseline justify-between gap-3 border-b border-ink/[0.08] px-4 py-3">
                    <h2 className="text-body font-medium text-ink">Digital Twin result</h2>
                    <p className="num text-meta text-ink-3">{twin.sample_size} cases replayed</p>
                  </div>

                  <dl className="grid grid-cols-3 divide-x divide-ink/[0.08] border-b border-ink/[0.08]">
                    {[
                      {
                        label: 'Budget delta',
                        value: `${twin.budget_delta_pkr >= 0 ? '+' : ''}${pkr(twin.budget_delta_pkr)} PKR`,
                      },
                      { label: 'Flipped cases', value: String(twin.flipped_cases.length) },
                      { label: 'Sample', value: String(twin.sample_size) },
                    ].map((cell) => (
                      <div key={cell.label} className="px-4 py-3">
                        <dt className="text-meta text-ink-3">{cell.label}</dt>
                        <dd className="num mt-0.5 font-mono text-lead font-medium text-ink">
                          {cell.value}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  {/* Before vs After route distribution + transition matrix */}
                  <div className="grid gap-4 border-b border-ink/[0.08] px-4 py-3 md:grid-cols-2">
                    <div>
                      <p className="mb-2 text-meta font-medium text-ink-2">Route shift (Before → After)</p>
                      <div className="space-y-1.5">
                        {Array.from(
                          new Set([
                            ...Object.keys(twin.before_counts ?? {}),
                            ...Object.keys(twin.after_counts ?? {}),
                          ]),
                        ).map((route) => {
                          const before = twin.before_counts?.[route] ?? 0;
                          const after = twin.after_counts?.[route] ?? 0;
                          const delta = after - before;
                          return (
                            <div key={route} className="flex items-center justify-between text-meta">
                              <span className="font-mono text-ink-2">{route}</span>
                              <span className="num font-mono text-ink">
                                {before} → <strong>{after}</strong>{' '}
                                {delta !== 0 && (
                                  <span className={delta > 0 ? 'text-positive' : 'text-negative'}>
                                    ({delta > 0 ? `+${delta}` : delta})
                                  </span>
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {twin.transition_matrix && Object.keys(twin.transition_matrix).length > 0 && (
                      <div>
                        <p className="mb-2 text-meta font-medium text-ink-2">Transition matrix</p>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(twin.transition_matrix).map(([edge, count]) => (
                            <Chip key={edge} tone="info">
                              {edge}: {count}
                            </Chip>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <table className="ledger">
                    <thead>
                      <tr>
                        <th>Case</th>
                        <th>Before</th>
                        <th>After</th>
                        <th>Amount Δ</th>
                        <th>Why</th>
                      </tr>
                    </thead>
                    <tbody>
                      {twin.flipped_cases.slice(0, 20).map((c) => {
                        const beforeRoute = c.before_route ?? c.before_outcome ?? '—';
                        const afterRoute = c.after_route ?? c.after_outcome ?? '—';
                        const beforeAmt = c.before_amount ?? c.before_amount_pkr ?? null;
                        const afterAmt = c.after_amount ?? c.after_amount_pkr ?? null;
                        const reason = c.primary_reason ?? c.reason_en ?? '—';
                        return (
                          <tr key={c.case_id}>
                            <td className="font-mono text-meta text-ink-2">{c.reference_code}</td>
                            <td className="font-mono text-meta text-ink-3">{beforeRoute}</td>
                            <td className="font-mono text-meta font-medium text-ink">{afterRoute}</td>
                            <td className="num font-mono text-meta text-ink-2">
                              {beforeAmt !== null || afterAmt !== null
                                ? `${beforeAmt !== null ? pkr(beforeAmt) : '0'} → ${afterAmt !== null ? pkr(afterAmt) : '0'}`
                                : '—'}
                            </td>
                            <td className="text-meta text-ink-2">{reason}</td>
                          </tr>
                        );
                      })}
                      {twin.flipped_cases.length === 0 && (
                        <tr>
                          <td colSpan={5} className="text-caption text-ink-3">
                            No case changes outcome under this draft.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </Card>
              )}

              {!readOnly && (
                <Card>
                  <CardTitle hint="validate, simulate, then publish">Publish</CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => saveDraft.mutate()}
                      disabled={saveDraft.isPending}
                      className="press min-h-[36px] rounded-control border border-ink/[0.14] bg-card px-3 text-caption text-ink hover:bg-raised disabled:opacity-50"
                    >
                      Save draft
                    </button>
                    <button
                      type="button"
                      onClick={() => validate.mutate()}
                      disabled={validate.isPending}
                      className="press min-h-[36px] rounded-control border border-ink/[0.14] bg-card px-3 text-caption text-ink hover:bg-raised disabled:opacity-50"
                    >
                      Validate
                    </button>
                    <button
                      type="button"
                      onClick={() => simulate.mutate()}
                      disabled={simulate.isPending}
                      className="press min-h-[36px] rounded-control border border-ink/[0.14] bg-card px-3 text-caption text-ink hover:bg-raised disabled:opacity-50"
                    >
                      Simulate (Digital Twin)
                    </button>
                    <input
                      value={changeNote}
                      onChange={(e) => setChangeNote(e.target.value)}
                      placeholder="Change note (required)"
                      aria-label="Change note"
                      className="field min-w-[200px] flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => publish.mutate()}
                      disabled={publish.isPending || changeNote.trim().length === 0}
                      className="press min-h-[36px] rounded-control bg-accent px-4 text-caption font-medium text-white hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Publish
                    </button>
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

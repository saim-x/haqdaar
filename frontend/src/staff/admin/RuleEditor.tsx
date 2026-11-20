import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, FlaskConical, GitBranch, Plus, Rocket, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '../../shared/api/client';
import { admin, programs } from '../../shared/api/endpoints';
import type { EligibilityRule, RuleSet, RuleVersion, TwinResult } from '../../shared/api/types';
import { useAuth } from '../../shared/auth/store';
import { Button } from '../../shared/ui/Button';
import { cx } from '../../shared/ui/cx';
import { Modal } from '../../shared/ui/Modal';
import { PageLoader } from '../../shared/ui/Spinner';
import { BeforeAfterBars } from '../charts';
import { EmptyState, ErrorState, Field, fmtTime, Hash, inputCls, PageHeader, Panel, pkr } from '../ui';
import { diffRules, FACTS, factType } from './facts';

const OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in'] as const;

function ValueInput({ rule, onChange, disabled }: { rule: EligibilityRule; onChange: (v: unknown) => void; disabled: boolean }) {
  const t = factType(rule.fact);
  if (rule.op === 'in' || rule.op === 'not_in') {
    const list = Array.isArray(rule.value) ? (rule.value as unknown[]) : [];
    return (
      <input
        className={inputCls}
        disabled={disabled}
        value={list.join(', ')}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .map((s) => (t === 'int' ? Number(s) : s)),
          )
        }
        aria-label={`${rule.id} values (comma separated)`}
      />
    );
  }
  if (t === 'bool')
    return (
      <select className={inputCls} disabled={disabled} value={String(rule.value)} onChange={(e) => onChange(e.target.value === 'true')} aria-label={`${rule.id} value`}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  if (t === 'int')
    return (
      <input
        type="number"
        className={cx(inputCls, 'font-mono')}
        disabled={disabled}
        value={typeof rule.value === 'number' ? rule.value : ''}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        aria-label={`${rule.id} value`}
      />
    );
  return <input className={inputCls} disabled={disabled} value={String(rule.value ?? '')} onChange={(e) => onChange(e.target.value)} aria-label={`${rule.id} value`} />;
}

function RuleCard({ rule, onChange, onRemove, disabled, errors }: { rule: EligibilityRule; onChange: (r: EligibilityRule) => void; onRemove: () => void; disabled: boolean; errors: Record<string, string> }) {
  const set = <K extends keyof EligibilityRule>(k: K, v: EligibilityRule[K]) => onChange({ ...rule, [k]: v });
  const [open, setOpen] = useState(false);
  const hasErr = Object.keys(errors).length > 0;
  return (
    <li className={cx('rounded-lg border p-3', hasErr ? 'border-danger bg-danger-soft/40' : 'border-border')}>
      <div className="grid gap-2 md:grid-cols-[130px_minmax(0,1.6fr)_90px_minmax(0,1fr)_100px_100px_auto] md:items-end">
        <Field label="Rule id" error={errors.id}>
          <input className={cx(inputCls, 'font-mono')} disabled={disabled} value={rule.id} onChange={(e) => set('id', e.target.value.toUpperCase())} />
        </Field>
        <Field label="Fact" error={errors.fact}>
          <select className={inputCls} disabled={disabled} value={rule.fact} onChange={(e) => set('fact', e.target.value)}>
            {!FACTS.some((f) => f.key === rule.fact) && <option value={rule.fact}>{rule.fact} (unknown)</option>}
            {FACTS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.key}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Op">
          <select className={cx(inputCls, 'font-mono')} disabled={disabled} value={rule.op} onChange={(e) => set('op', e.target.value as EligibilityRule['op'])}>
            {OPS.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </Field>
        <Field label="Value" error={errors.value}>
          <ValueInput rule={rule} disabled={disabled} onChange={(v) => set('value', v)} />
        </Field>
        <Field label="If FAIL">
          <select className={inputCls} disabled={disabled} value={rule.on_fail} onChange={(e) => set('on_fail', e.target.value as 'HUMAN')}>
            <option value="HUMAN">HUMAN</option>
            <option value="ASK">ASK</option>
          </select>
        </Field>
        <Field label="If UNKNOWN">
          <select className={inputCls} disabled={disabled} value={rule.on_unknown} onChange={(e) => set('on_unknown', e.target.value as 'HUMAN')}>
            <option value="HUMAN">HUMAN</option>
            <option value="ASK">ASK</option>
          </select>
        </Field>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            Text
          </Button>
          {!disabled && (
            <Button size="sm" variant="ghost" onClick={onRemove} aria-label={`Remove ${rule.id}`} icon={<Trash2 className="h-4 w-4 text-danger" aria-hidden />} />
          )}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {FACTS.find((f) => f.key === rule.fact)?.label} · never auto-rejects: a FAIL routes to {rule.on_fail === 'HUMAN' ? 'an officer' : 'the citizen for more info'}.
      </p>
      {(open || hasErr) && (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {(
            [
              ['label_en', 'Label (English)'],
              ['label_ur', 'Label (Urdu)'],
              ['pass_reason_en', 'Pass reason (English)'],
              ['pass_reason_ur', 'Pass reason (Urdu)'],
              ['fail_reason_en', 'Fail reason (English)'],
              ['fail_reason_ur', 'Fail reason (Urdu)'],
              ['ask_prompt_en', 'Ask prompt (English)'],
              ['ask_prompt_ur', 'Ask prompt (Urdu)'],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={label} error={errors[k]}>
              <input
                className={cx(inputCls, k.endsWith('_ur') && 'font-urdu')}
                dir={k.endsWith('_ur') ? 'rtl' : 'ltr'}
                lang={k.endsWith('_ur') ? 'ur' : 'en'}
                disabled={disabled}
                value={(rule[k] as string | null) ?? ''}
                onChange={(e) => set(k, e.target.value)}
              />
            </Field>
          ))}
        </div>
      )}
    </li>
  );
}

function TwinPanel({ result }: { result: TwinResult }) {
  const cats = ['APPROVED', 'NEEDS_INFO', 'HUMAN_REVIEW'] as const;
  const delta = result.budget_delta_pkr;
  return (
    <Panel title="Digital Twin · replay on past decided cases" className="border-info/40" id="twin">
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className={cx('rounded-card p-4', delta > 0 ? 'bg-warn-soft' : delta < 0 ? 'bg-ok-soft' : 'bg-muted')}>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Budget delta</p>
            <p className={cx('num mt-1 text-4xl font-bold', delta > 0 ? 'text-warn' : delta < 0 ? 'text-ok' : 'text-foreground')}>
              {delta > 0 ? '+' : ''}
              {pkr(delta)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">over {result.sample_size} replayed cases</p>
          </div>
          <div className="rounded-card bg-muted p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Outcome changes</p>
            <p className="num mt-1 text-4xl font-bold">{result.flipped_count}</p>
            <p className="mt-1 text-xs text-muted-foreground">cases would get a different result or amount</p>
          </div>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Pure in-memory replay: no decisions, payments or messages touched on real cases.
          </p>
        </div>
        <BeforeAfterBars title="Outcome counts before and after" categories={cats.map((c) => c.replace('_', ' '))} before={cats.map((c) => result.before_counts[c] ?? 0)} after={cats.map((c) => result.after_counts[c] ?? 0)} />
      </div>
      {result.flipped_cases.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="mb-2 text-left text-sm font-bold">Every case that changes, and why</caption>
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-1.5 pe-3">Case</th>
                <th className="py-1.5 pe-3">Before</th>
                <th className="py-1.5 pe-3">After</th>
                <th className="py-1.5 pe-3">Amount</th>
                <th className="py-1.5">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {result.flipped_cases.map((f) => (
                <tr key={f.case_id}>
                  <td className="py-1.5 pe-3 font-mono text-xs">{f.reference_code}</td>
                  <td className="py-1.5 pe-3 text-xs font-semibold">{f.before_route}</td>
                  <td className={cx('py-1.5 pe-3 text-xs font-bold', f.after_route === 'APPROVED' ? 'text-ok' : 'text-warn')}>{f.after_route}</td>
                  <td className="py-1.5 pe-3 font-mono text-xs">
                    {pkr(f.before_amount)} → {pkr(f.after_amount)}
                  </td>
                  <td className="py-1.5 text-xs text-muted-foreground">{f.primary_reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** Admin rule editor: draft → validate → simulate (Digital Twin) → publish (docs/11 §6.2, F-15/F-16). */
export function RuleEditor() {
  const { user } = useAuth();
  const readOnly = user?.role !== 'ADMIN';
  const qc = useQueryClient();
  const programsQ = useQuery({ queryKey: ['programs'], queryFn: programs.list });
  const [programId, setProgramId] = useState<string | null>(null);
  const pid = programId ?? programsQ.data?.[0]?.id ?? null;
  const versionsQ = useQuery({ queryKey: ['rules', pid], queryFn: () => admin.ruleVersions(pid!), enabled: !!pid });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RuleSet | null>(null);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<{ path: string; message: string }[] | null>(null);
  const [twin, setTwin] = useState<TwinResult | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [note, setNote] = useState('');

  const versions = versionsQ.data ?? [];
  const active = versions.find((v) => v.status === 'PUBLISHED');
  const selected = versions.find((v) => v.id === selectedId) ?? versions.find((v) => v.status === 'DRAFT') ?? active;
  const editable = !readOnly && selected?.status === 'DRAFT';

  useEffect(() => {
    if (selected) {
      setDraft(structuredClone(selected.rules_json));
      setDirty(false);
      setErrors(null);
      setTwin(null);
    }
  }, [selected?.id, selected?.content_hash]); // eslint-disable-line react-hooks/exhaustive-deps

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['rules', pid] });
  const createDraft = useMutation({
    mutationFn: () => admin.createDraft(pid!),
    onSuccess: (rv) => {
      setSelectedId(rv.id);
      invalidate();
    },
  });
  const save = useMutation({
    mutationFn: () => admin.updateDraft(selected!.id, draft!),
    onSuccess: () => {
      setDirty(false);
      invalidate();
    },
  });
  const validate = useMutation({
    mutationFn: async () => {
      if (dirty) await admin.updateDraft(selected!.id, draft!);
      setDirty(false);
      return admin.validate(selected!.id);
    },
    onSuccess: (r) => setErrors(r.errors),
  });
  const simulate = useMutation({
    mutationFn: async () => {
      if (dirty) await admin.updateDraft(selected!.id, draft!);
      setDirty(false);
      return admin.simulate(selected!.id);
    },
    onSuccess: (r) => {
      setTwin(r);
      setTimeout(() => document.getElementById('twin')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    },
  });
  const publish = useMutation({
    mutationFn: async () => {
      if (dirty) await admin.updateDraft(selected!.id, draft!);
      return admin.publish(selected!.id, note.trim());
    },
    onSuccess: (rv) => {
      toast.success(`Rule v${rv.version_number ?? ''} published`, { description: 'Live now. No restart, no redeploy.' });
      setPublishOpen(false);
      setNote('');
      setSelectedId(rv.id ?? null);
      invalidate();
      void qc.invalidateQueries({ queryKey: ['programs'] });
    },
    onError: (e) => {
      const err = e as ApiError;
      if (err.code === 'RULE_VALIDATION_FAILED')
        setErrors(((err.details?.errors as { path?: string; message?: string; message_en?: string }[]) ?? []).map((x) => ({ path: String(x.path ?? ''), message: x.message ?? x.message_en ?? 'Invalid' })));
    },
  });

  const errorMap = useMemo(() => {
    const m: Record<number, Record<string, string>> = {};
    const other: string[] = [];
    for (const e of errors ?? []) {
      // Accepts "eligibility_rules[3].fact" (contract) and "eligibility_rules.3.fact" (pydantic loc).
      const r = e.path.match(/^eligibility_rules(?:\[(\d+)\]|\.(\d+))\.(\w+)/);
      if (r) (m[Number(r[1] ?? r[2])] ??= {})[r[3]] = e.message;
      else other.push(`${e.path}: ${e.message}`);
    }
    return { rules: m, other };
  }, [errors]);

  const changes = active && draft && selected?.status === 'DRAFT' ? diffRules(active.rules_json, draft) : [];
  const update = (fn: (d: RuleSet) => RuleSet) => {
    setDraft((d) => (d ? fn(structuredClone(d)) : d));
    setDirty(true);
    setTwin(null);
  };

  if (programsQ.isLoading || versionsQ.isLoading) return <PageLoader />;
  if (programsQ.error) return <ErrorState error={programsQ.error} />;
  if (!pid) return <EmptyState title="No programs in this tenant" />;

  const p = draft?.policy;
  const f = draft?.benefit_formula;
  const num = (v: number | string) => (v === '' ? 0 : Number(v));

  return (
    <div>
      <PageHeader
        eyebrow="Policy · no code changes, no redeploy"
        title="Rules & Digital Twin"
        subtitle="Edit eligibility rules in a form, see their effect on past cases, then publish. Published versions are immutable and every decision records the version + hash it used."
        actions={
          <>
            <select className={cx(inputCls, 'w-auto')} value={pid} onChange={(e) => { setProgramId(e.target.value); setSelectedId(null); }} aria-label="Program">
              {programsQ.data?.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.name}
                </option>
              ))}
            </select>
            {!readOnly && (
              <Button size="sm" icon={<GitBranch className="h-4 w-4" aria-hidden />} loading={createDraft.isPending} onClick={() => createDraft.mutate()} disabled={versions.some((v) => v.status === 'DRAFT')}>
                New draft from active
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
        <Panel title="Versions">
          <ul className="space-y-2">
            {versions.map((v: RuleVersion) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(v.id)}
                  aria-current={selected?.id === v.id}
                  className={cx('w-full rounded-lg border p-3 text-start transition-colors duration-fast', selected?.id === v.id ? 'border-primary bg-primary-soft' : 'border-border hover:border-input')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold">v{v.version_number}</span>
                    <span
                      className={cx(
                        'rounded px-1.5 py-0.5 text-[11px] font-bold',
                        v.status === 'PUBLISHED' ? 'bg-ok text-white' : v.status === 'DRAFT' ? 'bg-warn-soft text-warn' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {v.status === 'PUBLISHED' ? 'ACTIVE' : v.status}
                    </span>
                  </div>
                  <Hash value={v.content_hash} className="mt-1 inline-block" />
                  {v.change_note && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{v.change_note}</p>}
                  <p className="mt-1 text-[11px] text-muted-foreground">{v.published_at ? `Published ${fmtTime(v.published_at)}${v.published_by ? ` by ${v.published_by}` : ''}` : `Created ${fmtTime(v.created_at)}`}</p>
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        {draft && selected && p && f ? (
          <div className="min-w-0 space-y-5">
            {editable && (
              <div className="sticky top-[36px] z-20 flex flex-wrap items-center gap-2 rounded-card border border-border bg-card/95 p-3 shadow-card backdrop-blur">
                <span className="me-auto text-sm">
                  Editing <strong>draft v{selected.version_number}</strong>
                  {dirty && <span className="ms-2 text-warn">· unsaved changes</span>}
                </span>
                <Button size="sm" variant="secondary" icon={<Save className="h-4 w-4" aria-hidden />} loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
                  Save draft
                </Button>
                <Button size="sm" variant="secondary" icon={<CircleCheck className="h-4 w-4" aria-hidden />} loading={validate.isPending} onClick={() => validate.mutate()}>
                  Validate
                </Button>
                <Button size="sm" variant="secondary" icon={<FlaskConical className="h-4 w-4" aria-hidden />} loading={simulate.isPending} onClick={() => simulate.mutate()}>
                  Simulate (Digital Twin)
                </Button>
                <Button size="sm" icon={<Rocket className="h-4 w-4" aria-hidden />} onClick={() => setPublishOpen(true)}>
                  Publish
                </Button>
              </div>
            )}

            {errors && (
              <div role="status" className={cx('rounded-card border p-3 text-sm', errors.length ? 'border-danger/40 bg-danger-soft text-danger' : 'border-ok/40 bg-ok-soft text-ok')}>
                {errors.length ? (
                  <>
                    <p className="flex items-center gap-1.5 font-bold">
                      <CircleX className="h-4 w-4" aria-hidden />
                      {errors.length} validation error{errors.length > 1 ? 's' : ''}. Fix the marked fields before publishing.
                    </p>
                    {errorMap.other.length > 0 && (
                      <ul className="mt-1 list-inside list-disc">
                        {errorMap.other.map((o) => (
                          <li key={o}>{o}</li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <p className="flex items-center gap-1.5 font-bold">
                    <CircleCheck className="h-4 w-4" aria-hidden />
                    Valid: every fact is canonical, types match, Urdu + English explanations present.
                  </p>
                )}
              </div>
            )}

            {changes.length > 0 && (
              <Panel title={`Changes vs active v${active!.version_number}`}>
                <ul className="space-y-1 font-mono text-xs">
                  {changes.map((c) => (
                    <li key={c} className="rounded bg-muted px-2 py-1">
                      {c}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {twin && <TwinPanel result={twin} />}

            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title="Routing policy (cost of being wrong)">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Auto-approve confidence threshold" hint="0.50 – 0.99 · Bayes break-even with costs 100 / 8 is 0.92">
                    <input type="number" step="0.01" min="0.5" max="0.99" className={cx(inputCls, 'font-mono')} disabled={!editable} value={p.auto_approve_confidence_threshold} onChange={(e) => update((d) => ({ ...d, policy: { ...d.policy, auto_approve_confidence_threshold: num(e.target.value) } }))} />
                  </Field>
                  <Field label="Max amount for auto-approval (PKR)">
                    <input type="number" className={cx(inputCls, 'font-mono')} disabled={!editable} value={p.auto_approve_max_amount_pkr} onChange={(e) => update((d) => ({ ...d, policy: { ...d.policy, auto_approve_max_amount_pkr: num(e.target.value) } }))} />
                  </Field>
                  <Field label="Max ask-more rounds">
                    <input type="number" min="0" max="5" className={cx(inputCls, 'font-mono')} disabled={!editable} value={p.max_ask_more_rounds} onChange={(e) => update((d) => ({ ...d, policy: { ...d.policy, max_ask_more_rounds: num(e.target.value) } }))} />
                  </Field>
                  <Field label="Cost: wrong approval / human review">
                    <div className="flex gap-2">
                      <input type="number" className={cx(inputCls, 'font-mono')} disabled={!editable} value={p.cost_matrix.wrong_approval_cost} onChange={(e) => update((d) => ({ ...d, policy: { ...d.policy, cost_matrix: { ...d.policy.cost_matrix, wrong_approval_cost: num(e.target.value) } } }))} aria-label="Wrong approval cost" />
                      <input type="number" className={cx(inputCls, 'font-mono')} disabled={!editable} value={p.cost_matrix.unnecessary_human_review_cost} onChange={(e) => update((d) => ({ ...d, policy: { ...d.policy, cost_matrix: { ...d.policy.cost_matrix, unnecessary_human_review_cost: num(e.target.value) } } }))} aria-label="Human review cost" />
                    </div>
                  </Field>
                </div>
              </Panel>
              <Panel title="Benefit formula">
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ['base_amount_pkr', 'Base amount (PKR)'],
                      ['per_child_bonus_pkr', 'Per-child bonus (PKR)'],
                      ['max_children_counted', 'Max children counted'],
                      ['hard_cap_pkr', 'Hard cap (PKR)'],
                    ] as const
                  ).map(([k, label]) => (
                    <Field key={k} label={label}>
                      <input type="number" className={cx(inputCls, 'font-mono')} disabled={!editable} value={f[k]} onChange={(e) => update((d) => ({ ...d, benefit_formula: { ...d.benefit_formula, [k]: num(e.target.value) } }))} />
                    </Field>
                  ))}
                </div>
                <p className="mt-3 rounded-lg bg-muted p-2 font-mono text-xs">
                  amount = min({f.hard_cap_pkr}, {f.base_amount_pkr} + min(children, {f.max_children_counted}) × {f.per_child_bonus_pkr}) → 3 children = {pkr(Math.min(f.hard_cap_pkr, f.base_amount_pkr + Math.min(3, f.max_children_counted) * f.per_child_bonus_pkr))}
                </p>
              </Panel>
            </div>

            <Panel
              title={`Eligibility rules (${draft.eligibility_rules.length})`}
              actions={
                editable && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Plus className="h-4 w-4" aria-hidden />}
                    onClick={() =>
                      update((d) => ({
                        ...d,
                        eligibility_rules: [
                          ...d.eligibility_rules,
                          { id: `R${String(d.eligibility_rules.length + 1).padStart(2, '0')}_NEW`, fact: 'household_size', op: 'gte', value: 1, on_fail: 'HUMAN', on_unknown: 'ASK', required_for_auto: true, label_en: '', label_ur: '', pass_reason_en: '', pass_reason_ur: '', fail_reason_en: '', fail_reason_ur: '', ask_prompt_en: null, ask_prompt_ur: null },
                        ],
                      }))
                    }
                  >
                    Add rule
                  </Button>
                )
              }
            >
              <ul className="space-y-3">
                {draft.eligibility_rules.map((r, i) => (
                  <RuleCard
                    key={i}
                    rule={r}
                    disabled={!editable}
                    errors={errorMap.rules[i] ?? {}}
                    onChange={(nr) => update((d) => ({ ...d, eligibility_rules: d.eligibility_rules.map((x, k) => (k === i ? nr : x)) }))}
                    onRemove={() => update((d) => ({ ...d, eligibility_rules: d.eligibility_rules.filter((_, k) => k !== i) }))}
                  />
                ))}
              </ul>
            </Panel>

            <details className="card p-4">
              <summary className="cursor-pointer text-sm font-bold">Read-only JSON (what is hashed and stored)</summary>
              <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">{JSON.stringify(draft, null, 2)}</pre>
            </details>
          </div>
        ) : (
          <EmptyState title="Select a version" />
        )}
      </div>

      <Modal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        title={`Publish v${selected?.version_number}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPublishOpen(false)}>
              Cancel
            </Button>
            <Button loading={publish.isPending} disabled={!note.trim()} onClick={() => publish.mutate()} icon={<Rocket className="h-4 w-4" aria-hidden />}>
              Publish now
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm">The next evaluation uses this version immediately. Past decisions keep the version and hash they were made with.</p>
          {changes.length > 0 && (
            <ul className="space-y-1 font-mono text-xs">
              {changes.map((c) => (
                <li key={c} className="rounded bg-muted px-2 py-1">
                  {c}
                </li>
              ))}
            </ul>
          )}
          {twin && (
            <p className="rounded-lg bg-info-soft p-2 text-sm text-info">
              Twin: {twin.flipped_count} of {twin.sample_size} cases change · budget {twin.budget_delta_pkr >= 0 ? '+' : ''}
              {pkr(twin.budget_delta_pkr)}
            </p>
          )}
          <Field label="Change note (required, shown in history and to auditors)">
            <textarea rows={3} className={cx(inputCls, 'py-2')} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Lower income cap to 35,000 and raise child bonus to 1,500 per finance directive 14/2026" />
          </Field>
          {publish.error && <ErrorState error={publish.error} />}
        </div>
      </Modal>
    </div>
  );
}

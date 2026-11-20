import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { errorMessage } from '../../shared/api/errors';
import type { Program, RuleCondition, RuleValidationResult, RuleVersion, RulesJson, TwinResult } from '../../shared/api/types';
import { Card, CardTitle, Chip, ErrorState, Loading, PageHeader } from '../ui';

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
];

const OPS = ['<=', '<', '>=', '>', '==', '!=', 'in', 'not_in', 'is_true', 'is_false'];
const OUTCOMES = ['PASS', 'FAIL', 'ASK', 'HUMAN_REVIEW'];

function emptyCondition(): RuleCondition {
  return {
    id: `rule_${Math.random().toString(36).slice(2, 8)}`,
    fact: 'monthly_income_pkr',
    op: '<=',
    value: 40000,
    on_fail: 'FAIL',
    on_unknown: 'ASK',
    reason_en: '',
    reason_ur: '',
  };
}

/**
 * Admin rule editor — docs/11 §6.2, AC-15.x.
 * Form-first: no JSON typing required. The JSON preview is read-only.
 */
export default function RulesPage() {
  const queryClient = useQueryClient();
  const [programId, setProgramId] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string>('');
  const [draft, setDraft] = useState<RulesJson | null>(null);
  const [changeNote, setChangeNote] = useState('');
  const [validation, setValidation] = useState<RuleValidationResult | null>(null);
  const [twin, setTwin] = useState<TwinResult | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger' | 'warn'; text: string } | null>(null);

  const programs = useQuery({
    queryKey: ['programs'],
    queryFn: () => api.get<{ items: Program[] }>('/programs'),
  });

  useEffect(() => {
    if (!programId && programs.data?.items[0]) setProgramId(programs.data.items[0].id);
  }, [programs.data, programId]);

  const versions = useQuery({
    queryKey: ['rule-versions', programId],
    queryFn: () => api.get<{ items: RuleVersion[] }>(`/admin/programs/${programId}/rules`),
    enabled: programId.length > 0,
  });

  useEffect(() => {
    if (!selectedId && versions.data?.items[0]) {
      const first = versions.data.items[0];
      setSelectedId(first.id);
      setDraft(first.rules_json);
    }
  }, [versions.data, selectedId]);

  const selected = useMemo(
    () => versions.data?.items.find((v) => v.id === selectedId) ?? null,
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
    mutationFn: () => api.post<RuleValidationResult>(`/admin/rules/${selectedId}/validate`),
    onSuccess: (res) => {
      setValidation(res);
      setMessage(
        res.valid
          ? { tone: 'ok', text: 'Validation passed.' }
          : { tone: 'danger', text: `${res.errors.length} validation error(s).` },
      );
    },
    onError: (err) => setMessage({ tone: 'danger', text: errorMessage(err, 'en') }),
  });

  const simulate = useMutation({
    mutationFn: () => api.post<TwinResult>(`/admin/rules/${selectedId}/simulate`, { sample_size: 200 }),
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
      setMessage({ tone: 'ok', text: `Draft v${res.version_number} created from the active version.` });
      void queryClient.invalidateQueries({ queryKey: ['rule-versions', programId] });
    },
    onError: (err) => setMessage({ tone: 'danger', text: errorMessage(err, 'en') }),
  });

  function updateCondition(index: number, patch: Partial<RuleCondition>) {
    setDraft((prev) => {
      if (!prev) return prev;
      const conditions = prev.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c));
      return { ...prev, conditions };
    });
  }

  function addCondition() {
    setDraft((prev) => (prev ? { ...prev, conditions: [...prev.conditions, emptyCondition()] } : prev));
  }

  function removeCondition(index: number) {
    setDraft((prev) => (prev ? { ...prev, conditions: prev.conditions.filter((_, i) => i !== index) } : prev));
  }

  if (programs.isLoading) return <Loading />;
  if (programs.error) return <ErrorState error={programs.error} />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Rules & Digital Twin"
        subtitle="Publish a new version without a deploy. Published versions are immutable."
        actions={
          <>
            <select
              value={programId}
              onChange={(e) => {
                setProgramId(e.target.value);
                setSelectedId('');
                setDraft(null);
                setTwin(null);
              }}
              className="min-h-tap rounded-lg border border-ink/15 bg-white px-2 text-xs font-semibold"
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
              disabled={createDraft.isPending || !programId}
              className="min-h-tap rounded-lg bg-teal-700 px-3 text-xs font-bold text-white disabled:opacity-50"
            >
              New draft
            </button>
          </>
        }
      />

      {message && (
        <div
          role="status"
          className={`rounded-lg border-2 px-3 py-2 text-xs font-semibold ${
            message.tone === 'ok'
              ? 'border-[#0F7B3F]/30 bg-[#0F7B3F]/5 text-[#0F7B3F]'
              : message.tone === 'warn'
                ? 'border-amber-400/50 bg-amber-50 text-amber-700'
                : 'border-[#B42318]/30 bg-[#B42318]/5 text-[#B42318]'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardTitle hint={`${versions.data?.items.length ?? 0} versions`}>Version history</CardTitle>
          <ul className="space-y-1">
            {versions.data?.items.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(v.id);
                    setDraft(v.rules_json);
                    setValidation(null);
                    setTwin(null);
                  }}
                  className={`w-full rounded-lg px-2 py-1.5 text-left text-xs ${
                    selectedId === v.id ? 'bg-teal-50 text-teal-800' : 'hover:bg-ink/5'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="font-bold">v{v.version_number}</span>
                    <Chip tone={v.status === 'PUBLISHED' ? 'ok' : v.status === 'DRAFT' ? 'warn' : 'neutral'}>
                      {v.status}
                    </Chip>
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-ink-soft">{v.content_hash.slice(0, 16)}…</span>
                  {v.change_note && <span className="mt-0.5 block truncate text-[10px] text-ink-soft">{v.change_note}</span>}
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-4">
          {!draft && <Card><p className="text-xs text-ink-soft">Select a version to edit, or create a new draft.</p></Card>}

          {draft && (
            <>
              <Card>
                <CardTitle hint={readOnly ? 'read-only — published versions are immutable' : 'form editor'}>
                  Conditions
                </CardTitle>
                <div className="space-y-2">
                  {draft.conditions.map((condition, index) => (
                    <div key={condition.id} className="rounded-lg border border-ink/10 p-2">
                      <div className="grid gap-1.5 sm:grid-cols-4">
                        <label className="text-[10px] font-bold uppercase text-ink-soft">
                          Fact
                          <select
                            value={condition.fact}
                            disabled={readOnly}
                            onChange={(e) => updateCondition(index, { fact: e.target.value })}
                            className="mt-0.5 w-full rounded border border-ink/15 px-1 py-1 text-[11px] font-normal normal-case"
                          >
                            {FACT_KEYS.map((k) => (
                              <option key={k} value={k}>
                                {k}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-[10px] font-bold uppercase text-ink-soft">
                          Op
                          <select
                            value={condition.op}
                            disabled={readOnly}
                            onChange={(e) => updateCondition(index, { op: e.target.value })}
                            className="mt-0.5 w-full rounded border border-ink/15 px-1 py-1 text-[11px] font-normal normal-case"
                          >
                            {OPS.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-[10px] font-bold uppercase text-ink-soft">
                          Value
                          <input
                            value={String(condition.value ?? '')}
                            disabled={readOnly}
                            onChange={(e) => updateCondition(index, { value: e.target.value })}
                            className="mt-0.5 w-full rounded border border-ink/15 px-1 py-1 text-[11px] font-normal normal-case"
                          />
                        </label>
                        <div className="grid grid-cols-2 gap-1">
                          <label className="text-[10px] font-bold uppercase text-ink-soft">
                            On fail
                            <select
                              value={condition.on_fail}
                              disabled={readOnly}
                              onChange={(e) => updateCondition(index, { on_fail: e.target.value })}
                              className="mt-0.5 w-full rounded border border-ink/15 px-1 py-1 text-[11px] font-normal normal-case"
                            >
                              {OUTCOMES.map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-[10px] font-bold uppercase text-ink-soft">
                            On unknown
                            <select
                              value={condition.on_unknown}
                              disabled={readOnly}
                              onChange={(e) => updateCondition(index, { on_unknown: e.target.value })}
                              className="mt-0.5 w-full rounded border border-ink/15 px-1 py-1 text-[11px] font-normal normal-case"
                            >
                              {OUTCOMES.map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </div>
                      <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                        <label className="text-[10px] font-bold uppercase text-ink-soft">
                          Reason (English)
                          <input
                            value={condition.reason_en}
                            disabled={readOnly}
                            onChange={(e) => updateCondition(index, { reason_en: e.target.value })}
                            className="mt-0.5 w-full rounded border border-ink/15 px-1 py-1 text-[11px] font-normal normal-case"
                          />
                        </label>
                        <label className="text-[10px] font-bold uppercase text-ink-soft">
                          Reason (اردو)
                          <input
                            dir="rtl"
                            value={condition.reason_ur}
                            disabled={readOnly}
                            onChange={(e) => updateCondition(index, { reason_ur: e.target.value })}
                            className="mt-0.5 w-full rounded border border-ink/15 px-1 py-1 text-[11px] font-normal normal-case"
                          />
                        </label>
                      </div>
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => removeCondition(index)}
                          className="mt-1 text-[10px] font-bold text-[#B42318] hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {!readOnly && (
                  <button type="button" onClick={addCondition} className="mt-2 rounded bg-ink/5 px-2 py-1 text-[11px] font-bold text-ink-soft">
                    + Add condition
                  </button>
                )}
              </Card>

              <Card>
                <CardTitle>Benefit formula & threshold</CardTitle>
                <div className="grid gap-2 sm:grid-cols-4">
                  {(
                    [
                      ['base_amount_pkr', 'Base PKR'],
                      ['per_child_amount_pkr', 'Per child PKR'],
                      ['cap_amount_pkr', 'Cap PKR'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="text-[10px] font-bold uppercase text-ink-soft">
                      {label}
                      <input
                        type="number"
                        value={draft.benefit[key]}
                        disabled={readOnly}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev ? { ...prev, benefit: { ...prev.benefit, [key]: Number(e.target.value) } } : prev,
                          )
                        }
                        className="mt-0.5 w-full rounded border border-ink/15 px-1 py-1 text-[11px] font-normal normal-case"
                      />
                    </label>
                  ))}
                  <label className="text-[10px] font-bold uppercase text-ink-soft">
                    Confidence threshold
                    <input
                      type="number"
                      step="0.01"
                      min="0.5"
                      max="0.99"
                      value={draft.confidence_threshold}
                      disabled={readOnly}
                      onChange={(e) =>
                        setDraft((prev) => (prev ? { ...prev, confidence_threshold: Number(e.target.value) } : prev))
                      }
                      className="mt-0.5 w-full rounded border border-ink/15 px-1 py-1 text-[11px] font-normal normal-case"
                    />
                  </label>
                </div>
              </Card>

              <Card>
                <CardTitle hint="read-only">JSON preview</CardTitle>
                <pre className="max-h-64 overflow-auto rounded bg-[#1B1B1B] p-2 text-[10px] leading-relaxed text-[#E7E5E4]">
                  {JSON.stringify(draft, null, 2)}
                </pre>
              </Card>

              {validation && !validation.valid && (
                <Card className="border-2 border-[#B42318]/30">
                  <CardTitle>Validation errors</CardTitle>
                  <ul className="space-y-1">
                    {validation.errors.map((err) => (
                      <li key={`${err.field}-${err.message_en}`} className="text-xs">
                        <span className="font-mono text-[#B42318]">{err.field}</span>: {err.message_en}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              {twin && (
                <Card>
                  <CardTitle hint={`${twin.sample_size} cases replayed`}>Digital Twin result</CardTitle>
                  <div className="mb-2 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-lg bg-ink/5 p-2">
                      <p className="text-[10px] font-bold uppercase text-ink-soft">Budget delta</p>
                      <p className="num text-lg font-bold text-ink">
                        {twin.budget_delta_pkr >= 0 ? '+' : ''}
                        {twin.budget_delta_pkr.toLocaleString()} PKR
                      </p>
                    </div>
                    <div className="rounded-lg bg-ink/5 p-2">
                      <p className="text-[10px] font-bold uppercase text-ink-soft">Flipped cases</p>
                      <p className="num text-lg font-bold text-ink">{twin.flipped_cases.length}</p>
                    </div>
                    <div className="rounded-lg bg-ink/5 p-2">
                      <p className="text-[10px] font-bold uppercase text-ink-soft">Sample</p>
                      <p className="num text-lg font-bold text-ink">{twin.sample_size}</p>
                    </div>
                  </div>
                  <table className="w-full text-left text-[11px]">
                    <thead>
                      <tr className="border-b border-ink/10 text-[10px] uppercase text-ink-soft">
                        <th className="py-1">Case</th>
                        <th className="py-1">Before</th>
                        <th className="py-1">After</th>
                        <th className="py-1">Why</th>
                      </tr>
                    </thead>
                    <tbody>
                      {twin.flipped_cases.slice(0, 20).map((c) => (
                        <tr key={c.case_id} className="border-b border-ink/5">
                          <td className="py-1 font-mono">{c.reference_code}</td>
                          <td className="py-1">{c.before_outcome}</td>
                          <td className="py-1 font-semibold">{c.after_outcome}</td>
                          <td className="py-1 text-ink-soft">{c.reason_en}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}

              {!readOnly && (
                <Card>
                  <CardTitle>Publish</CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => saveDraft.mutate()}
                      disabled={saveDraft.isPending}
                      className="min-h-tap rounded-lg border border-ink/15 bg-white px-3 text-xs font-semibold"
                    >
                      Save draft
                    </button>
                    <button
                      type="button"
                      onClick={() => validate.mutate()}
                      disabled={validate.isPending}
                      className="min-h-tap rounded-lg border border-ink/15 bg-white px-3 text-xs font-semibold"
                    >
                      Validate
                    </button>
                    <button
                      type="button"
                      onClick={() => simulate.mutate()}
                      disabled={simulate.isPending}
                      className="min-h-tap rounded-lg border border-ink/15 bg-white px-3 text-xs font-semibold"
                    >
                      Simulate (Digital Twin)
                    </button>
                    <input
                      value={changeNote}
                      onChange={(e) => setChangeNote(e.target.value)}
                      placeholder="Change note (required)"
                      className="min-h-tap min-w-[200px] flex-1 rounded-lg border border-ink/15 px-2 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => publish.mutate()}
                      disabled={publish.isPending || changeNote.trim().length === 0}
                      className="min-h-tap rounded-lg bg-teal-700 px-3 text-xs font-bold text-white disabled:opacity-50"
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

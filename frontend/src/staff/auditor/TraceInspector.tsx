import { useQuery } from '@tanstack/react-query';
import { Bot, FileSearch, Search, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { auditor } from '../../shared/api/endpoints';
import type { DecisionTrace } from '../../shared/api/types';
import { Button } from '../../shared/ui/Button';
import { cx } from '../../shared/ui/cx';
import { PageLoader } from '../../shared/ui/Spinner';
import { FactsTable, RuleTrace } from '../officer/CaseReview';
import { ConfidenceBar, EmptyState, ErrorState, fmtTime, Hash, inputCls, PageHeader, Panel, pkr, ReasonChip } from '../ui';

const SHOWCASE = ['HQ-2026-000101', 'HQ-2026-000102', 'HQ-2026-000103', 'HQ-2026-000105'];

function Decision({ d, index }: { d: DecisionTrace; index: number }) {
  const [raw, setRaw] = useState(false);
  const isAI = d.decision_source === 'AI_ENGINE';
  return (
    <section className="card overflow-hidden">
      <header className={cx('flex flex-wrap items-center gap-3 border-b border-border px-4 py-3', isAI ? 'bg-consent-soft' : 'bg-info-soft')}>
        {isAI ? <Bot className="h-5 w-5 text-consent" aria-hidden /> : <UserRound className="h-5 w-5 text-info" aria-hidden />}
        <h2 className="font-bold">
          Decision {index + 1} · {d.decision_source}
          {d.actor_label ? ` · ${d.actor_label}` : ''}
        </h2>
        <ReasonChip code={d.route_action} />
        <span className="text-sm">
          → <strong>{d.outcome_status}</strong>
        </span>
        {d.is_override && <span className="rounded bg-warn px-1.5 py-0.5 text-xs font-bold text-white">OFFICER OVERRIDE</span>}
        <span className="ms-auto text-xs text-muted-foreground">{fmtTime(d.created_at)}</span>
      </header>
      <div className="grid gap-5 p-4 xl:grid-cols-2">
        <div className="space-y-4">
          <dl className="grid grid-cols-[150px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Rule version</dt>
            <dd>
              v{d.rule_version_number} <Hash value={d.rule_content_hash} />
            </dd>
            <dt className="text-muted-foreground">Input snapshot</dt>
            <dd>
              <Hash value={d.input_snapshot_hash} />
            </dd>
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="font-mono">{pkr(d.computed_amount_pkr)}</dd>
            <dt className="text-muted-foreground">Escalation reasons</dt>
            <dd className="flex flex-wrap gap-1">{d.escalation_reasons.length ? d.escalation_reasons.map((r) => <ReasonChip key={r} code={r} />) : <span className="text-muted-foreground">none</span>}</dd>
            <dt className="text-muted-foreground">Model versions</dt>
            <dd className="flex flex-wrap gap-1">
              {Object.entries(d.model_versions).map(([k, v]) => (
                <span key={k} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                  {k}={v}
                </span>
              ))}
            </dd>
            {d.officer_reason_codes && d.officer_reason_codes.length > 0 && (
              <>
                <dt className="text-muted-foreground">Officer reasons</dt>
                <dd className="flex flex-wrap gap-1">
                  {d.officer_reason_codes.map((r) => (
                    <ReasonChip key={r} code={r} />
                  ))}
                </dd>
                <dt className="text-muted-foreground">Officer note</dt>
                <dd>{d.officer_note}</dd>
              </>
            )}
          </dl>
          <div>
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">Confidence (weakest link)</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <ConfidenceBar value={d.confidence_components.identity} label="Identity" />
              <ConfidenceBar value={d.confidence_components.documents} label="Documents" />
              <ConfidenceBar value={d.confidence_components.data_consistency} label="Data consistency" />
              <ConfidenceBar value={d.confidence_components.consent_assurance} label="Consent assurance" />
            </div>
            <p className="mt-2 text-sm">
              Overall <span className="font-mono font-bold">{d.confidence_overall.toFixed(3)}</span>
            </p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-muted-foreground">Citizen view (simple reason)</h3>
            <p className="font-urdu" lang="ur" dir="rtl">
              {d.citizen_explanation.headline_ur}
            </p>
            <p className="text-sm text-muted-foreground">{d.citizen_explanation.headline_en}</p>
            <ul className="mt-1 list-inside list-disc text-sm">
              {d.citizen_explanation.reasons_en.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">Rule trace</h3>
            <RuleTrace trace={d.rule_trace_json} />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Input facts at decision time</h3>
              <Button size="sm" variant="ghost" onClick={() => setRaw((r) => !r)} aria-pressed={raw}>
                {raw ? 'Table' : 'Raw JSON'}
              </Button>
            </div>
            {raw ? <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">{JSON.stringify(d.input_snapshot_json, null, 2)}</pre> : <FactsTable facts={d.input_snapshot_json} />}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Decision Trace Inspector: auditor view of every decision on a case (AC-18.2). */
export function TraceInspector() {
  const { id } = useParams();
  const nav = useNavigate();
  const [lookup, setLookup] = useState('');
  const q = useQuery({ queryKey: ['trace', id], queryFn: () => auditor.trace(id!), enabled: !!id, retry: false });

  return (
    <div>
      <PageHeader eyebrow="Auditor · read-only" title="Decision trace inspector" subtitle="Input snapshot + hash, rule version + hash, model versions, 4-pillar confidence, route, and the plain-language reason the citizen saw." />
      <form
        className="mb-5 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (lookup.trim()) nav(`/auditor/cases/${lookup.trim()}`);
        }}
      >
        <input className={cx(inputCls, 'max-w-xs font-mono')} placeholder="HQ-2026-000101 or case id" value={lookup} onChange={(e) => setLookup(e.target.value)} aria-label="Case reference" />
        <Button type="submit" size="sm" icon={<Search className="h-4 w-4" aria-hidden />}>
          Open trace
        </Button>
        <div className="flex flex-wrap items-center gap-1.5">
          {SHOWCASE.map((r) => (
            <button key={r} type="button" onClick={() => nav(`/auditor/cases/${r}`)} className="rounded-full border border-border px-2.5 py-1 font-mono text-xs hover:border-primary">
              {r}
            </button>
          ))}
        </div>
      </form>

      {!id ? (
        <EmptyState title="Pick a case" body="Enter a reference code, or click an event in the audit log." />
      ) : q.isLoading ? (
        <PageLoader />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <div className="space-y-5">
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <FileSearch className="h-5 w-5" aria-hidden />
            <span className="font-mono">{q.data!.reference_code}</span>
            <span className="text-sm font-normal text-muted-foreground">· {q.data!.decisions.length} decision(s)</span>
          </h2>
          {q.data!.decisions.length === 0 && <EmptyState title="No decisions yet" body="The case has not been evaluated." />}
          {q.data!.decisions.map((d, i) => (
            <Decision key={d.id} d={d} index={i} />
          ))}
          {q.data!.agent_steps.length > 0 && (
            <Panel title="Agent steps (tool calls to simulated DPI services)">
              <ol className="space-y-1.5 text-sm">
                {q.data!.agent_steps.map((s, i) => (
                  <li key={i} className="grid grid-cols-[150px_170px_80px_minmax(0,1fr)] gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{fmtTime(s.at)}</span>
                    <span className="font-mono text-xs font-semibold">{s.tool}</span>
                    <span className={cx('text-xs font-bold', s.status === 'FAILED' ? 'text-danger' : s.status === 'RETRIED' ? 'text-warn' : 'text-ok')}>{s.status}</span>
                    <span className="text-xs text-muted-foreground">
                      {s.summary} ({s.duration_ms} ms)
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

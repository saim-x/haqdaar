import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import type { DecisionTrace } from '../../shared/api/types';
import { Card, CardTitle, Chip, ErrorState, Loading, PageHeader } from '../ui';

function Pillar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  const tone = value >= 0.9 ? 'bg-[#0F7B3F]' : value >= 0.7 ? 'bg-amber-400' : 'bg-[#B42318]';
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="font-semibold text-ink-soft">{label}</span>
        <span className="num font-bold text-ink">{value.toFixed(3)}</span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-ink/10">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Decision trace inspector — docs/11 §6.3.3, AC-18.2. */
export default function TracePage({ caseId }: { caseId?: string } = {}) {
  const params = useParams();
  const id = caseId ?? params.id ?? '';
  const query = useQuery({
    queryKey: ['auditor-trace', id],
    queryFn: () => api.get<DecisionTrace>(`/auditor/cases/${id}/trace`),
    enabled: id.length > 0,
  });

  if (query.isLoading) return <Loading label="Loading trace…" />;
  if (query.error) return <ErrorState error={query.error} />;

  const trace = query.data;
  if (!trace) return <ErrorState error={new Error('No trace')} />;

  const facts = Object.entries(trace.case.facts ?? {});

  return (
    <div className="space-y-4">
      <PageHeader
        title="Decision trace"
        subtitle={`${trace.case.reference_code} · ${trace.case.status} · ${trace.case.citizen?.full_name ?? 'unknown citizen'}`}
      />

      {trace.decisions.length === 0 && (
        <Card>
          <p className="text-xs text-ink-soft">No decisions recorded for this case yet.</p>
        </Card>
      )}

      {trace.decisions.map((decision) => (
        <div key={decision.id} className="space-y-3">
          <Card>
            <CardTitle hint={new Date(decision.created_at).toLocaleString()}>
              {decision.decision_source} · {trace.case.reference_code}
            </CardTitle>
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <p className="text-[10px] font-bold uppercase text-ink-soft">Route</p>
                <Chip
                  tone={
                    decision.route_action === 'AUTO_APPROVE'
                      ? 'ok'
                      : decision.route_action === 'HUMAN_REVIEW'
                        ? 'warn'
                        : 'info'
                  }
                >
                  {decision.route_action}
                </Chip>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-ink-soft">Outcome</p>
                <p className="text-xs font-bold text-ink">{decision.outcome_status}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-ink-soft">Amount</p>
                <p className="num text-xs font-bold text-ink">
                  {decision.computed_amount_pkr !== null
                    ? `PKR ${decision.computed_amount_pkr.toLocaleString()}`
                    : '—'}
                </p>
              </div>
            </div>
            {decision.is_override && (
              <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">
                Officer override — counted in the evaluation dashboard.
              </p>
            )}
            {decision.escalation_reasons.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {decision.escalation_reasons.map((code) => (
                  <Chip key={code} tone="danger">
                    {code}
                  </Chip>
                ))}
              </div>
            )}
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardTitle hint="weakest link">Confidence pillars</CardTitle>
              <div className="space-y-2">
                <Pillar label="Identity" value={decision.confidence_components.identity} />
                <Pillar label="Documents" value={decision.confidence_components.documents} />
                <Pillar label="Data consistency" value={decision.confidence_components.data_consistency} />
                <Pillar label="Consent assurance" value={decision.confidence_components.consent_assurance} />
                <Pillar label="Overall" value={decision.confidence_components.overall} />
              </div>
            </Card>

            <Card>
              <CardTitle hint="self-contained proof">Hashes & versions</CardTitle>
              <dl className="space-y-1 text-[11px]">
                <div>
                  <dt className="text-ink-soft">Rule version id</dt>
                  <dd className="break-all font-mono">{decision.rule_version_id}</dd>
                </div>
                <div>
                  <dt className="text-ink-soft">Rule hash</dt>
                  <dd className="break-all font-mono">{decision.rule_content_hash}</dd>
                </div>
                <div>
                  <dt className="text-ink-soft">Input snapshot hash</dt>
                  <dd className="break-all font-mono">{decision.input_snapshot_hash}</dd>
                </div>
                <div>
                  <dt className="text-ink-soft">Model versions</dt>
                  <dd className="font-mono">{JSON.stringify(decision.model_versions)}</dd>
                </div>
              </dl>
            </Card>
          </div>

          {decision.citizen_explanation && (
            <Card>
              <CardTitle hint="what the citizen saw">Citizen explanation</CardTitle>
              <p className="text-sm font-semibold text-ink" dir="rtl">
                {decision.citizen_explanation.headline_ur}
              </p>
              <p className="mt-1 text-xs text-ink-soft">{decision.citizen_explanation.headline_en}</p>
              <ul className="mt-2 space-y-0.5 text-[11px] text-ink-soft">
                {decision.citizen_explanation.reasons_en.map((reason) => (
                  <li key={reason}>• {reason}</li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      ))}

      <Card className="overflow-x-auto">
        <CardTitle hint={`${facts.length} facts`}>Input snapshot (facts + sources)</CardTitle>
        <table className="w-full min-w-[520px] text-left text-[11px]">
          <thead>
            <tr className="border-b border-ink/10 text-[10px] uppercase text-ink-soft">
              <th className="py-1">Fact</th>
              <th className="py-1">Value</th>
              <th className="py-1">Source</th>
              <th className="py-1">Entered by</th>
            </tr>
          </thead>
          <tbody>
            {facts.map(([key, fact]) => (
              <tr key={key} className="border-b border-ink/5">
                <td className="py-1 font-mono">{key}</td>
                <td className="py-1 font-semibold">
                  {fact.value === null ? (
                    <span className="text-ink-soft">UNKNOWN{fact.missing_reason ? ` (${fact.missing_reason})` : ''}</span>
                  ) : (
                    String(fact.value)
                  )}
                </td>
                <td className="py-1 text-ink-soft">{fact.source ?? '—'}</td>
                <td className="py-1 text-ink-soft">{fact.entered_by ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {trace.notes.length > 0 && (
        <Card>
          <CardTitle hint={`${trace.notes.length} notes`}>Notes</CardTitle>
          <ul className="space-y-1.5">
            {trace.notes.map((note) => (
              <li key={note.id} className="rounded border border-ink/10 p-2 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <Chip tone="neutral">{note.note_type}</Chip>
                  <span className="text-ink-soft">{new Date(note.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-ink">{note.body}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardTitle hint="read-only">Raw trace</CardTitle>
        <pre className="max-h-72 overflow-auto rounded bg-[#1B1B1B] p-2 text-[10px] leading-relaxed text-[#E7E5E4]">
          {JSON.stringify({ case: trace.case, decisions: trace.decisions }, null, 2)}
        </pre>
      </Card>
    </div>
  );
}

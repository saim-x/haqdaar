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
    queryFn: () => api.get<{ traces: DecisionTrace[] }>(`/auditor/cases/${id}/trace`),
  });

  if (query.isLoading) return <Loading label="Loading trace…" />;
  if (query.error) return <ErrorState error={query.error} />;

  const traces = query.data?.traces ?? [];

  return (
    <div className="space-y-4">
      <PageHeader title="Decision trace" subtitle={`Case ${id}`} />

      {traces.length === 0 && <Card><p className="text-xs text-ink-soft">No decisions recorded for this case yet.</p></Card>}

      {traces.map((trace) => (
        <div key={trace.decision_id} className="space-y-3">
          <Card>
            <CardTitle hint={new Date(trace.created_at).toLocaleString()}>
              {trace.decision_source} · {trace.reference_code}
            </CardTitle>
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <p className="text-[10px] font-bold uppercase text-ink-soft">Route</p>
                <Chip tone={trace.route_action === 'AUTO_APPROVE' ? 'ok' : trace.route_action === 'HUMAN_REVIEW' ? 'warn' : 'info'}>
                  {trace.route_action}
                </Chip>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-ink-soft">Outcome</p>
                <p className="text-xs font-bold text-ink">{trace.outcome_status}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-ink-soft">Amount</p>
                <p className="num text-xs font-bold text-ink">
                  {trace.computed_amount_pkr !== null ? `PKR ${trace.computed_amount_pkr.toLocaleString()}` : '—'}
                </p>
              </div>
            </div>
            {trace.is_override && (
              <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">
                Officer override — counted in the evaluation dashboard.
              </p>
            )}
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardTitle hint="weakest link">Confidence pillars</CardTitle>
              <div className="space-y-2">
                <Pillar label="Identity" value={trace.confidence_components.identity} />
                <Pillar label="Documents" value={trace.confidence_components.documents} />
                <Pillar label="Data consistency" value={trace.confidence_components.data_consistency} />
                <Pillar label="Consent assurance" value={trace.confidence_components.consent_assurance} />
                <Pillar label="Overall" value={trace.confidence_components.overall} />
              </div>
            </Card>

            <Card>
              <CardTitle hint="self-contained proof">Hashes & versions</CardTitle>
              <dl className="space-y-1 text-[11px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-soft">Rule version</dt>
                  <dd className="font-bold">v{trace.rule_version_number}</dd>
                </div>
                <div>
                  <dt className="text-ink-soft">Rule hash</dt>
                  <dd className="break-all font-mono">{trace.rule_content_hash}</dd>
                </div>
                <div>
                  <dt className="text-ink-soft">Input snapshot hash</dt>
                  <dd className="break-all font-mono">{trace.input_snapshot_hash}</dd>
                </div>
                <div>
                  <dt className="text-ink-soft">Model versions</dt>
                  <dd className="font-mono">{JSON.stringify(trace.model_versions)}</dd>
                </div>
              </dl>
            </Card>
          </div>

          <Card className="overflow-x-auto">
            <CardTitle hint={`${trace.rule_trace_json.length} rules`}>Rule trace</CardTitle>
            <table className="w-full min-w-[520px] text-left text-[11px]">
              <thead>
                <tr className="border-b border-ink/10 text-[10px] uppercase text-ink-soft">
                  <th className="py-1">Rule</th>
                  <th className="py-1">Result</th>
                  <th className="py-1">Actual</th>
                  <th className="py-1">Expected</th>
                </tr>
              </thead>
              <tbody>
                {trace.rule_trace_json.map((entry) => (
                  <tr key={entry.rule_id} className="border-b border-ink/5">
                    <td className="py-1 font-mono">{entry.rule_id}</td>
                    <td className="py-1">
                      <Chip tone={entry.result === 'PASS' ? 'ok' : entry.result === 'FAIL' ? 'danger' : 'warn'}>
                        {entry.result}
                      </Chip>
                    </td>
                    <td className="py-1 font-mono">{JSON.stringify(entry.actual)}</td>
                    <td className="py-1 font-mono">{JSON.stringify(entry.expected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card>
            <CardTitle hint="what the citizen saw">Citizen explanation</CardTitle>
            <p className="text-sm font-semibold text-ink" dir="rtl">{trace.citizen_explanation.headline_ur}</p>
            <p className="mt-1 text-xs text-ink-soft">{trace.citizen_explanation.headline_en}</p>
            <ul className="mt-2 space-y-0.5 text-[11px] text-ink-soft">
              {trace.citizen_explanation.reasons_en.map((reason) => (
                <li key={reason}>• {reason}</li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardTitle hint="read-only">Input snapshot</CardTitle>
            <pre className="max-h-72 overflow-auto rounded bg-[#1B1B1B] p-2 text-[10px] leading-relaxed text-[#E7E5E4]">
              {JSON.stringify(trace.input_snapshot_json, null, 2)}
            </pre>
          </Card>
        </div>
      ))}
    </div>
  );
}

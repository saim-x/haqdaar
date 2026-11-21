import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import type { DecisionTrace } from '../../shared/api/types';
import { Card, CardTitle, Chip, ErrorState, Loading, PageHeader } from '../ui';

/**
 * One confidence pillar. The number is the fact and the track is the glance;
 * a 2px rule reads at a distance without turning the panel into a bar chart.
 */
function Pillar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  const tone = value >= 0.9 ? 'bg-positive' : value >= 0.7 ? 'bg-warn' : 'bg-negative';
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-meta text-ink-2">{label}</span>
        <span className="num font-mono text-meta font-medium text-ink">{value.toFixed(3)}</span>
      </div>
      <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-ink/[0.10]">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Hash({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-ink/[0.06] py-2 last:border-b-0">
      <dt className="text-meta text-ink-3">{label}</dt>
      <dd className="mt-0.5 break-all font-mono text-meta text-ink-2">{value}</dd>
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
          <p className="text-caption text-ink-3">No decisions recorded for this case yet.</p>
        </Card>
      )}

      {trace.decisions.map((decision) => (
        <div key={decision.id} className="space-y-3">
          <Card>
            <CardTitle hint={new Date(decision.created_at).toLocaleString()}>
              {decision.decision_source} · {trace.case.reference_code}
            </CardTitle>

            <dl className="grid grid-cols-3 divide-x divide-ink/[0.08] border-y border-ink/[0.08]">
              <div className="py-2 pe-4">
                <dt className="text-meta text-ink-3">Route</dt>
                <dd className="mt-1">
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
                </dd>
              </div>
              <div className="px-4 py-2">
                <dt className="text-meta text-ink-3">Outcome</dt>
                <dd className="mt-1 text-caption font-medium text-ink">
                  {decision.outcome_status}
                </dd>
              </div>
              <div className="py-2 ps-4">
                <dt className="text-meta text-ink-3">Amount</dt>
                <dd className="num mt-1 font-mono text-caption font-medium text-ink">
                  {decision.computed_amount_pkr !== null
                    ? `PKR ${decision.computed_amount_pkr.toLocaleString()}`
                    : '—'}
                </dd>
              </div>
            </dl>

            {decision.is_override && (
              <p className="mt-3 rounded-control border border-warn/25 bg-warn-wash px-3 py-2 text-meta text-warn">
                Officer override — counted in the evaluation dashboard.
              </p>
            )}

            {decision.escalation_reasons.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
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
              <div className="space-y-3">
                <Pillar label="Identity" value={decision.confidence_components.identity} />
                <Pillar label="Documents" value={decision.confidence_components.documents} />
                <Pillar
                  label="Data consistency"
                  value={decision.confidence_components.data_consistency}
                />
                <Pillar
                  label="Consent assurance"
                  value={decision.confidence_components.consent_assurance}
                />
                <Pillar label="Overall" value={decision.confidence_components.overall} />
              </div>
            </Card>

            <Card>
              <CardTitle hint="self-contained proof">Hashes & versions</CardTitle>
              <dl>
                <Hash label="Rule version id" value={decision.rule_version_id} />
                <Hash label="Rule hash" value={decision.rule_content_hash} />
                <Hash label="Input snapshot hash" value={decision.input_snapshot_hash} />
                <Hash
                  label="Model versions"
                  value={JSON.stringify(decision.model_versions)}
                />
              </dl>
            </Card>
          </div>

          {decision.citizen_explanation && (
            <Card>
              <CardTitle hint="what the citizen saw">Citizen explanation</CardTitle>
              <p className="text-lead font-medium leading-[1.8] text-ink" dir="rtl">
                {decision.citizen_explanation.headline_ur}
              </p>
              <p className="mt-1 text-caption text-ink-2">
                {decision.citizen_explanation.headline_en}
              </p>
              <ul className="mt-3 space-y-1 border-t border-ink/[0.08] pt-3">
                {decision.citizen_explanation.reasons_en.map((reason) => (
                  <li key={reason} className="text-meta leading-[1.7] text-ink-2">
                    {reason}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      ))}

      <Card className="overflow-x-auto p-0">
        <div className="flex items-baseline justify-between gap-3 border-b border-ink/[0.08] px-4 py-3">
          <h2 className="text-body font-medium text-ink">Input snapshot (facts + sources)</h2>
          <p className="num text-meta text-ink-3">{facts.length} facts</p>
        </div>
        <table className="ledger min-w-[560px]">
          <thead>
            <tr>
              <th>Fact</th>
              <th>Value</th>
              <th>Source</th>
              <th>Entered by</th>
            </tr>
          </thead>
          <tbody>
            {facts.map(([key, fact]) => (
              <tr key={key}>
                <td className="font-mono text-meta text-ink-2">{key}</td>
                <td>
                  {fact.value === null ? (
                    <span className="inline-flex flex-wrap items-baseline gap-2">
                      <span className="text-caption text-ink-3">—</span>
                      {fact.missing_reason && (
                        <span className="font-mono text-meta text-ink-3">
                          {fact.missing_reason}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="num font-mono text-caption font-medium text-ink">
                      {String(fact.value)}
                    </span>
                  )}
                </td>
                <td className="text-meta text-ink-3">{fact.source ?? '—'}</td>
                <td className="text-meta text-ink-3">{fact.entered_by ?? '—'}</td>
              </tr>
            ))}
            {facts.length === 0 && (
              <tr>
                <td colSpan={4} className="text-caption text-ink-3">
                  No facts in this snapshot.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {trace.notes.length > 0 && (
        <Card>
          <CardTitle hint={`${trace.notes.length} notes`}>Notes</CardTitle>
          <ul className="space-y-2">
            {trace.notes.map((note) => (
              <li
                key={note.id}
                className="rounded-control border border-ink/[0.10] px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <Chip tone="neutral">{note.note_type}</Chip>
                  <span className="num text-meta text-ink-3">
                    {new Date(note.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 text-caption leading-[1.7] text-ink">{note.body}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardTitle hint="read-only">Raw trace</CardTitle>
        <pre className="max-h-72 overflow-auto rounded-control bg-raised p-3 font-mono text-meta leading-[1.6] text-ink-2">
          {JSON.stringify({ case: trace.case, decisions: trace.decisions }, null, 2)}
        </pre>
      </Card>
    </div>
  );
}

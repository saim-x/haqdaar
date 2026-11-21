import { useQuery } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import type { EvalDashboard } from '../../shared/api/types';
import { Card, CardTitle, ErrorState, Kpi, Loading, PageHeader, routeWord } from '../ui';

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

const SERIES = [
  { key: 'auto_approve_rate', label: 'auto-approve', colour: '#0F766E' },
  { key: 'human_review_rate', label: 'human review', colour: '#1D4ED8' },
  { key: 'false_approval_rate', label: 'false approval', colour: '#B42318' },
] as const;

/**
 * Inline SVG threshold sweep — no chart library in the bundle.
 *
 * Drawn on the same paper as everything else: hairline grid, one accent per
 * series, and the active threshold as a dashed rule rather than a filled band,
 * because the threshold is a position on the axis, not a region.
 */
function ThresholdSweep({
  data,
  active,
}: {
  data: EvalDashboard['decision_router_sweep'];
  active: number;
}) {
  const w = 560;
  const h = 200;
  const pad = 30;
  if (data.length === 0) return <p className="text-caption text-ink-3">No sweep data yet.</p>;

  const xs = data.map((d) => d.threshold);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const x = (t: number) => pad + ((t - minX) / Math.max(maxX - minX, 0.001)) * (w - pad * 2);
  const y = (v: number) => h - pad - Math.min(Math.max(v, 0), 1) * (h - pad * 2);

  return (
    <div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full"
        role="img"
        aria-label="Threshold sweep chart"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
          <g key={tick}>
            <line x1={pad} y1={y(tick)} x2={w - pad} y2={y(tick)} stroke="#EFEAE1" />
            <text x={pad - 8} y={y(tick) + 3} textAnchor="end" fontSize={9} fill="#8A8279">
              {Math.round(tick * 100)}%
            </text>
          </g>
        ))}
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#D6D3D1" />

        {SERIES.map(({ key, colour }) => (
          <polyline
            key={key}
            fill="none"
            stroke={colour}
            strokeWidth={1.75}
            strokeLinejoin="round"
            points={data.map((d) => `${x(d.threshold)},${y(d[key])}`).join(' ')}
          />
        ))}

        <line
          x1={x(active)}
          y1={pad}
          x2={x(active)}
          y2={h - pad}
          stroke="#B45309"
          strokeDasharray="3 3"
          strokeWidth={1.5}
        />
        <text x={x(active) + 5} y={pad + 9} fontSize={10} fill="#B45309">
          active {active.toFixed(2)}
        </text>

        {data.map((d) => (
          <text
            key={d.threshold}
            x={x(d.threshold)}
            y={h - pad + 13}
            textAnchor="middle"
            fontSize={8}
            fill="#8A8279"
          >
            {d.threshold.toFixed(2)}
          </text>
        ))}
      </svg>

      <div className="mt-2 flex flex-wrap gap-4 border-t border-ink/[0.08] pt-2">
        {SERIES.map(({ key, label, colour }) => (
          <span key={key} className="inline-flex items-center gap-1.5 text-meta text-ink-2">
            <span className="h-0.5 w-3" style={{ backgroundColor: colour }} aria-hidden />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-ink/[0.06] py-2">
      <dt className="text-meta text-ink-3">{label}</dt>
      <dd className="num mt-0.5 font-mono text-caption font-medium text-ink">{value}</dd>
    </div>
  );
}

/** Evaluation dashboard — docs/11 §6.4, AC-22.x. */
export default function EvalPage() {
  const query = useQuery({
    queryKey: ['eval-dashboard'],
    queryFn: () => api.get<EvalDashboard>('/eval/dashboard'),
    staleTime: 60_000,
  });

  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorState error={query.error} />;
  if (!query.data) return <ErrorState error={new Error('No evaluation data')} />;

  const {
    decision_router_sweep,
    active_threshold,
    scam_classifier,
    document_verifier,
    live_operations,
  } = query.data;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Evaluation"
        subtitle="The cost of being wrong, measured — not asserted."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Active threshold"
          value={active_threshold.toFixed(2)}
          hint="Router confidence floor"
        />
        <Kpi
          label="False approvals"
          value={pct(
            decision_router_sweep.find((d) => Math.abs(d.threshold - active_threshold) < 0.001)
              ?.false_approval_rate ?? 0,
          )}
          hint="At the active threshold"
        />
        <Kpi
          label="Scam hard-negative FPR"
          value={pct(scam_classifier.hard_negative_fpr)}
          hint="Benign money messages"
        />
        <Kpi
          label="Doc false-tamper"
          value={pct(document_verifier.false_tamper_rate)}
          hint="Genuine compressed docs"
        />
      </div>

      <Card>
        <CardTitle hint="0.50 – 0.95">Threshold sweep</CardTitle>
        <ThresholdSweep data={decision_router_sweep} active={active_threshold} />
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle hint={`${scam_classifier.test_size} held-out`}>Scam classifier</CardTitle>
          <dl className="grid grid-cols-2 gap-x-6 border-t border-ink/[0.08]">
            <Metric label="Precision" value={pct(scam_classifier.precision)} />
            <Metric label="Recall" value={pct(scam_classifier.recall)} />
            <Metric label="F1" value={scam_classifier.f1.toFixed(3)} />
            <Metric label="FPR" value={pct(scam_classifier.false_positive_rate)} />
            <Metric label="Live checks" value={String(scam_classifier.live_checks_count)} />
            <Metric label="User disputed" value={String(scam_classifier.user_disputed_count)} />
          </dl>

          <table className="ledger mt-4 text-center">
            <thead>
              <tr>
                <th className="text-start">actual</th>
                <th>predicted scam</th>
                <th>predicted benign</th>
              </tr>
            </thead>
            <tbody>
              {scam_classifier.confusion_matrix.map((row, i) => (
                <tr key={i}>
                  <td className="text-start text-meta text-ink-2">
                    {i === 0 ? 'scam' : 'benign'}
                  </td>
                  {row.map((cell, j) => (
                    <td key={j} className="num font-mono font-medium">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardTitle hint={`${document_verifier.test_size} images`}>Document verifier</CardTitle>
          <dl className="grid grid-cols-2 gap-x-6 border-t border-ink/[0.08]">
            <Metric label="Genuine verified" value={pct(document_verifier.genuine_verified_rate)} />
            <Metric label="Tamper caught" value={pct(document_verifier.tampered_caught_rate)} />
            <Metric label="False tamper" value={pct(document_verifier.false_tamper_rate)} />
            <Metric label="Blurry retake" value={pct(document_verifier.blurry_retake_rate)} />
          </dl>
        </Card>
      </div>

      <Card>
        <CardTitle hint="last 24h">Live operations</CardTitle>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi bare label="Decisions" value={String(live_operations.total_decisions)} />
          <Kpi bare label="Override rate" value={pct(live_operations.officer_override_rate)} />
          <Kpi bare label="p50" value={`${live_operations.latency_p50_ms}ms`} />
          <Kpi bare label="p95" value={`${live_operations.latency_p95_ms}ms`} />
          <Kpi
            bare
            label="LLM calls"
            value={String(live_operations.llm_calls_24h)}
            hint={`$${live_operations.llm_cost_usd_24h.toFixed(4)}`}
          />
          <Kpi bare label="LLM failures" value={pct(live_operations.llm_failure_rate)} />
        </div>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-ink/[0.08] pt-3">
          {Object.entries(live_operations.by_route).map(([route, count]) => (
            <span key={route} className="text-meta text-ink-2">
              <span>{routeWord(route)}</span>{' '}
              <span className="num font-medium text-ink">{count}</span>
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}

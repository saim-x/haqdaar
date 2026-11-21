import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import type { EvalDashboard } from '../../shared/api/types';
import { Card, CardTitle, Chip, ErrorState, Kpi, Loading, PageHeader, routeWord } from '../ui';

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

const SERIES = [
  { key: 'auto_approve_rate', label: 'auto-approve %', colour: 'var(--accent)' },
  { key: 'human_review_rate', label: 'human review %', colour: 'var(--info)' },
  { key: 'false_approval_rate', label: 'false approval %', colour: 'var(--negative)' },
] as const;

/**
 * Interactive Cost-of-Being-Wrong explorer - plots both the 3 routing rates
 * and the asymmetric Expected Cost U-curve (wrong approval = 100, review = 8,
 * ask more = 5), letting judges click any threshold τ to inspect the exact knee.
 */
function ThresholdSweep({
  data,
  active,
  knee,
}: {
  data: EvalDashboard['decision_router_sweep'];
  active: number;
  knee: number | null;
}) {
  const [selectedThreshold, setSelectedThreshold] = useState<number>(active);
  const w = 560;
  const h = 215;
  const padL = 36;
  const padR = 44;
  const padY = 26;
  if (data.length === 0) return <p className="text-caption text-ink-3">No sweep data yet.</p>;

  const xs = data.map((d) => d.threshold);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const maxCost = Math.max(...data.map((d) => d.expected_cost), 1);
  const x = (t: number) => padL + ((t - minX) / Math.max(maxX - minX, 0.001)) * (w - padL - padR);
  const y = (v: number) => h - padY - Math.min(Math.max(v, 0), 1) * (h - padY * 2);
  const yCost = (c: number) => h - padY - Math.min(Math.max(c / maxCost, 0), 1) * (h - padY * 2);

  const inspected =
    data.find((d) => Math.abs(d.threshold - selectedThreshold) < 0.001) ??
    data.find((d) => Math.abs(d.threshold - active) < 0.001) ??
    data[0];

  return (
    <div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full"
        role="img"
        aria-label="Threshold sweep and expected cost curve"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
          <g key={tick}>
            <line x1={padL} y1={y(tick)} x2={w - padR} y2={y(tick)} stroke="var(--rule)" />
            <text x={padL - 6} y={y(tick) + 3} textAnchor="end" fontSize={9} fill="var(--ink-3)">
              {Math.round(tick * 100)}%
            </text>
            <text x={w - padR + 6} y={y(tick) + 3} textAnchor="start" fontSize={9} fill="var(--warn)">
              {Math.round(tick * maxCost)}
            </text>
          </g>
        ))}
        <line x1={padL} y1={h - padY} x2={w - padR} y2={h - padY} stroke="var(--ink-3)" strokeOpacity={0.4} />

        {/* Expected cost U-curve (right axis) */}
        <polyline
          fill="none"
          stroke="var(--warn)"
          strokeWidth={2}
          strokeDasharray="4 2"
          strokeLinejoin="round"
          points={data.map((d) => `${x(d.threshold)},${yCost(d.expected_cost)}`).join(' ')}
        />

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

        {/* Active / knee reference rule */}
        <line
          x1={x(active)}
          y1={padY}
          x2={x(active)}
          y2={h - padY}
          stroke="var(--accent)"
          strokeDasharray="3 3"
          strokeWidth={1.5}
        />
        <text x={x(active) - 4} y={padY - 7} textAnchor="end" fontSize={9} fill="var(--accent)">
          active τ={active.toFixed(2)}{knee && Math.abs(knee - active) < 0.001 ? ' (knee)' : ''}
        </text>

        {/* Interactive clickable threshold nodes */}
        {data.map((d) => {
          const isSelected = inspected && Math.abs(d.threshold - inspected.threshold) < 0.001;
          return (
            <g
              key={d.threshold}
              className="cursor-pointer"
              onClick={() => setSelectedThreshold(d.threshold)}
            >
              <circle
                cx={x(d.threshold)}
                cy={yCost(d.expected_cost)}
                r={isSelected ? 5 : 3}
                fill={isSelected ? 'var(--warn)' : 'var(--card, #fff)'}
                stroke="var(--warn)"
                strokeWidth={1.75}
              />
              <text
                x={x(d.threshold)}
                y={h - padY + 14}
                textAnchor="middle"
                fontSize={isSelected ? 9.5 : 8}
                fontWeight={isSelected ? 600 : 400}
                fill={isSelected ? 'var(--ink)' : 'var(--ink-3)'}
              >
                {d.threshold.toFixed(2)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Interactive threshold selector & live readout */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink/[0.08] pt-3">
        <div className="flex flex-wrap gap-4">
          {SERIES.map(({ key, label, colour }) => (
            <span key={key} className="inline-flex items-center gap-1.5 text-meta text-ink-2">
              <span className="h-0.5 w-3" style={{ backgroundColor: colour }} aria-hidden />
              {label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 text-meta text-warn">
            <span className="h-0.5 w-3 border-t-2 border-dashed border-warn" aria-hidden />
            expected cost (right axis)
          </span>
        </div>
      </div>

      {inspected && (
        <div className="mt-3 grid gap-2 rounded-control border border-ink/[0.08] bg-raised/60 p-3 sm:grid-cols-5">
          <div>
            <p className="text-meta text-ink-3">Inspected τ</p>
            <p className="num font-mono text-body font-medium text-ink">
              {inspected.threshold.toFixed(2)}
              {Math.abs(inspected.threshold - active) < 0.001 && (
                <span className="ms-1.5 text-meta text-accent-ink">(active)</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-meta text-ink-3">Auto-approved</p>
            <p className="num font-mono text-body font-medium text-accent-ink">
              {pct(inspected.auto_approve_rate)}
            </p>
          </div>
          <div>
            <p className="text-meta text-ink-3">False approvals</p>
            <p
              className={`num font-mono text-body font-medium ${
                inspected.false_approval_rate === 0 ? 'text-positive' : 'text-negative'
              }`}
            >
              {pct(inspected.false_approval_rate)}
            </p>
          </div>
          <div>
            <p className="text-meta text-ink-3">Human review</p>
            <p className="num font-mono text-body font-medium text-info">
              {pct(inspected.human_review_rate)}
            </p>
          </div>
          <div>
            <p className="text-meta text-ink-3">Expected cost</p>
            <p className="num font-mono text-body font-medium text-warn">
              {Math.round(inspected.expected_cost)}
            </p>
          </div>
        </div>
      )}
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

/** Evaluation dashboard - docs/11 §6.4, AC-22.x. */
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
    knee_threshold,
    scam_classifier,
    document_verifier,
    live_operations,
  } = query.data;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Evaluation"
        subtitle="The cost of being wrong, measured - not asserted."
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
        <CardTitle hint="Click any τ point · wrong approval = 100, review = 8, ask = 5">
          Threshold sweep &amp; expected cost curve
        </CardTitle>
        <ThresholdSweep
          data={decision_router_sweep}
          active={active_threshold}
          knee={knee_threshold ?? null}
        />
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

          {/* confusion_matrix(labels=[0, 1]) → row/col 0 = benign, row/col 1 = scam */}
          <table className="ledger mt-4 text-center">
            <thead>
              <tr>
                <th className="text-start">actual \ predicted</th>
                <th>predicted benign</th>
                <th>predicted scam</th>
              </tr>
            </thead>
            <tbody>
              {scam_classifier.confusion_matrix.map((row, i) => (
                <tr key={i}>
                  <td className="text-start text-meta text-ink-2">
                    {i === 0 ? 'actual benign' : 'actual scam'}
                  </td>
                  {row.map((cell, j) => {
                    const tag = i === 0 && j === 0 ? 'TN' : i === 0 && j === 1 ? 'FP' : i === 1 && j === 0 ? 'FN' : 'TP';
                    return (
                      <td key={j} className="num font-mono font-medium">
                        {cell}{' '}
                        <span className="text-[11px] font-normal text-ink-3">({tag})</span>
                      </td>
                    );
                  })}
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

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-ink/[0.08] pt-3">
          {Object.entries(live_operations.by_route).map(([route, count]) => (
            <span key={route} className="text-meta text-ink-2">
              <span>{routeWord(route)}</span>{' '}
              <span className="num font-medium text-ink">{count}</span>
            </span>
          ))}
          {live_operations.active_provider && (
            <Chip tone={live_operations.active_provider === 'live' ? 'ok' : 'neutral'}>
              AI_PROVIDER={live_operations.active_provider}
            </Chip>
          )}
          {typeof live_operations.guardrail_triggers_24h === 'number' && (
            <Chip tone={live_operations.guardrail_triggers_24h > 0 ? 'warn' : 'ok'}>
              Guardrails (24h): {live_operations.guardrail_triggers_24h}
            </Chip>
          )}
        </div>

        {live_operations.ai_telemetry_by_task && live_operations.ai_telemetry_by_task.length > 0 && (
          <div className="mt-3 border-t border-ink/[0.08] pt-3">
            <p className="mb-2 text-meta font-medium text-ink-2">AI telemetry by task (24h)</p>
            <table className="ledger">
              <thead>
                <tr>
                  <th>Task</th>
                  <th className="text-end">Calls</th>
                  <th className="text-end">Avg latency</th>
                  <th className="text-end">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {live_operations.ai_telemetry_by_task.map((row) => (
                  <tr key={row.task_type}>
                    <td className="font-mono text-meta text-ink">{row.task_type}</td>
                    <td className="num text-end font-mono text-meta text-ink-2">{row.calls}</td>
                    <td className="num text-end font-mono text-meta text-ink-2">
                      {row.avg_latency_ms}ms
                    </td>
                    <td className="num text-end font-mono text-meta text-ink-2">
                      ${row.cost_usd.toFixed(5)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

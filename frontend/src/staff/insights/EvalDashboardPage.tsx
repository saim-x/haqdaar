import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { insights } from '../../shared/api/endpoints';
import { cx } from '../../shared/ui/cx';
import { PageLoader } from '../../shared/ui/Spinner';
import { LineChart } from '../charts';
import { ErrorState, PageHeader, Panel, pct, Stat } from '../ui';

/** Evaluation dashboard (F-22) — the numbers behind Challenge 01 and 08. */
export function EvalDashboardPage() {
  const q = useQuery({ queryKey: ['eval'], queryFn: insights.eval, refetchInterval: 15000 });
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} />;
  const d = q.data!;
  const pts = d.threshold_sweep.points;
  const tau = d.threshold_sweep.active_threshold;
  const at = pts.reduce((best, p) => (Math.abs(p.threshold - tau) < Math.abs(best.threshold - tau) ? p : best), pts[0]);
  const min = pts.reduce((best, p) => (p.expected_total_cost < best.expected_total_cost ? p : best), pts[0]);
  const cm = d.scam.confusion_matrix;
  const routes = Object.entries(d.live.route_distribution);
  const routeTotal = routes.reduce((a, [, n]) => a + n, 0);

  return (
    <div>
      <PageHeader
        eyebrow="Insight · honest numbers"
        title="Evaluation dashboard"
        subtitle="Why the system acts alone only above 0.90, how often it is wrong, and how often it raises false alarms. Scored on a labelled synthetic benchmark with independently injected noise."
      />

      {d.dataset_note && (
        <p role="status" className="mb-4 rounded-card border border-warn/40 bg-warn-soft p-3 text-sm text-warn">
          {d.dataset_note}
        </p>
      )}
      {d.benchmarks_available === false && (
        <p role="status" className="mb-4 rounded-card border border-line bg-sunken p-3 text-sm text-muted">
          Scam and document benchmarks are not published yet; their cards show “—” until the AI services report metrics.
        </p>
      )}
      <section className="card mb-5 p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-xl font-bold">The cost of being wrong</h2>
            <p className="mt-1 text-sm text-muted">
              A wrong approval costs <strong className="text-ink">100</strong>, an unnecessary human review <strong className="text-ink">8</strong>, an extra question <strong className="text-ink">5</strong>. Auto-approving
              beats a human only when <span className="font-mono">p(valid) &gt; 1 − 8/100 = 0.92</span>; weakest-link confidence under-estimates validity, so the sweep places the knee at{' '}
              <strong className="text-ink">τ = {tau.toFixed(2)}</strong>.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-sunken px-3 py-2">
              <p className="text-[11px] font-bold uppercase text-muted">Auto-approved</p>
              <p className="num text-2xl font-bold">{pct(at.auto_approve_rate)}</p>
            </div>
            <div className="rounded-lg bg-sunken px-3 py-2">
              <p className="text-[11px] font-bold uppercase text-muted">Wrong approvals</p>
              <p className={cx('num text-2xl font-bold', at.false_approval_rate <= 0.02 ? 'text-ok' : 'text-danger')}>{pct(at.false_approval_rate, 1)}</p>
            </div>
            <div className="rounded-lg bg-sunken px-3 py-2">
              <p className="text-[11px] font-bold uppercase text-muted">To officers</p>
              <p className="num text-2xl font-bold">{pct(at.human_review_load)}</p>
            </div>
          </div>
        </div>
        <LineChart
          title={`Threshold sweep over ${d.threshold_sweep.sample_size} labelled cases`}
          xLabel="Auto-approve confidence threshold τ"
          xs={pts.map((p) => p.threshold)}
          marker={tau}
          markerLabel={`active τ = ${tau.toFixed(2)}`}
          series={[
            { name: 'Expected total cost', values: pts.map((p) => p.expected_total_cost), className: 'stroke-danger', format: (v) => String(Math.round(v)) },
            { name: 'False approval rate', values: pts.map((p) => p.false_approval_rate), className: 'stroke-warn', dash: '6 4', axis: 'right', format: (v) => pct(v, 1) },
            { name: 'Human review load', values: pts.map((p) => p.human_review_load), className: 'stroke-info', dash: '2 4', axis: 'right', format: (v) => pct(v) },
          ]}
        />
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <Info className="h-3.5 w-3.5" aria-hidden />
          Minimum expected cost at τ = {min.threshold.toFixed(2)} ({Math.round(min.expected_total_cost)}). Raising τ to 0.95 sends far more honest widows to a queue; lowering it to 0.85 lets convincing frauds through.
        </p>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Scam classifier (held-out test set)">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Precision" value={pct(d.scam.precision)} />
              <Stat label="Recall" value={pct(d.scam.recall)} />
              <Stat label="Hard-negative false alarms" value={pct(d.scam.hard_negative_fpr)} tone={d.scam.hard_negative_fpr > 0.1 ? 'warn' : 'ok'} hint="Real money messages flagged as scam" />
              <Stat label="User-disputed results" value={d.scam.disputed_count} hint="'I think this is wrong' clicks" />
            </div>
            <div>
              <table className="w-full text-center text-sm" aria-label="Confusion matrix">
                <caption className="mb-1 text-xs font-bold uppercase text-muted">Confusion matrix (n={d.scam.test_size})</caption>
                <thead>
                  <tr className="text-[11px] text-muted">
                    <th />
                    <th className="pb-1">pred scam</th>
                    <th className="pb-1">pred safe</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  <tr>
                    <th className="pe-2 text-end text-[11px] font-normal text-muted">scam</th>
                    <td className="rounded-tl-lg bg-ok-soft p-3 text-lg font-bold text-ok">{cm.tp}</td>
                    <td className="bg-danger-soft p-3 text-lg font-bold text-danger" title="Missed scams">{cm.fn}</td>
                  </tr>
                  <tr>
                    <th className="pe-2 text-end text-[11px] font-normal text-muted">safe</th>
                    <td className="bg-warn-soft p-3 text-lg font-bold text-warn" title="False alarms">{cm.fp}</td>
                    <td className="rounded-br-lg bg-ok-soft p-3 text-lg font-bold text-ok">{cm.tn}</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted">Blocking a real person is also a cost: we never block, only advise.</p>
            </div>
          </div>
        </Panel>

        <Panel title="Document verifier (synthetic mock-specimen set)">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Genuine verified" value={pct(d.documents.genuine_verified_rate)} tone="ok" />
            <Stat label="Forgeries caught" value={pct(d.documents.tamper_catch_rate)} />
            <Stat label="False tamper alarms" value={pct(d.documents.false_tamper_rate)} tone={d.documents.false_tamper_rate === 0 ? 'ok' : 'danger'} hint="Incl. WhatsApp-compressed genuine cards" />
            <Stat label="Blurry → retake" value={pct(d.documents.blurry_retake_rate)} hint={`${d.documents.sample_size} images`} />
          </div>
        </Panel>

        <Panel title="Live operations">
          <div className="mb-4">
            <p className="mb-2 text-xs font-bold uppercase text-muted">Engine routes ({routeTotal} decisions)</p>
            <div className="flex h-6 overflow-hidden rounded-md" role="img" aria-label={routes.map(([k, n]) => `${k} ${n}`).join(', ')}>
              {routes.map(([k, n]) => (
                <div
                  key={k}
                  style={{ width: `${routeTotal ? (n / routeTotal) * 100 : 0}%` }}
                  className={cx(k === 'AUTO_APPROVE' ? 'bg-ok' : k === 'HUMAN_REVIEW' ? 'bg-info' : k === 'ASK_MORE' ? 'bg-warn' : 'bg-neutral')}
                  title={`${k}: ${n}`}
                />
              ))}
            </div>
            <ul className="mt-2 flex flex-wrap gap-3 text-xs">
              {routes.map(([k, n]) => (
                <li key={k} className="font-mono">
                  {k} <strong>{n}</strong>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Officer override rate" value={pct(d.live.officer_override_rate)} />
            <Stat label="Pipeline latency p50 / p95" value={`${(d.live.pipeline_latency_ms.p50 / 1000).toFixed(1)}s / ${(d.live.pipeline_latency_ms.p95 / 1000).toFixed(1)}s`} />
          </div>
        </Panel>

        <Panel title="LLM usage (never in the decision path)">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="AI calls" value={d.live.llm.calls} />
            <Stat label="Estimated cost" value={`$${d.live.llm.cost_usd.toFixed(4)}`} />
            <Stat label="Failure rate" value={pct(d.live.llm.failure_rate)} />
            <Stat label="Fallbacks to deterministic" value={d.live.llm.fallback_count} hint="Templates / tap input when the API is down" />
          </div>
        </Panel>
      </div>
    </div>
  );
}

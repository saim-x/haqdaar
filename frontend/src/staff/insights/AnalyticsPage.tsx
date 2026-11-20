import { useQuery } from '@tanstack/react-query';
import { insights } from '../../shared/api/endpoints';
import type { CaseStatus } from '../../shared/api/types';
import { STATUS, toneClasses } from '../../shared/status';
import { cx } from '../../shared/ui/cx';
import { PageLoader } from '../../shared/ui/Spinner';
import { EmptyState, ErrorState, PageHeader, Panel, pct, pkr, Stat } from '../ui';

/** Per-tenant analytics (F-23). Tenant is derived from the token on the server. */
export function AnalyticsPage() {
  const q = useQuery({ queryKey: ['analytics'], queryFn: insights.analytics, refetchInterval: 15000 });
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} />;
  const a = q.data!;
  const statuses = Object.entries(a.cases_by_status) as [CaseStatus, number][];
  const max = Math.max(1, ...statuses.map(([, n]) => n));

  return (
    <div>
      <PageHeader eyebrow={`Insight · ${a.tenant.code}`} title={`${a.tenant.name} analytics`} subtitle="Server-side tenant isolation: another department's officer sees only their own numbers." />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat lead label="PKR disbursed" value={pkr(a.disbursed_pkr)} tone="ok" hint="Simulated Raast transfers" />
        <Stat label="Applications" value={a.total_applications} />
        <Stat label="Approval rate" value={pct(a.approval_rate)} />
        <Stat label="Auto-approved" value={pct(a.auto_approve_pct)} hint={`Avg decision ${a.avg_time_to_decision_hours.toFixed(1)} h`} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Open and closed cases by status">
          {statuses.length === 0 ? (
            <EmptyState title="No cases yet" />
          ) : (
            <ul className="space-y-2">
              {statuses
                .sort((x, y) => y[1] - x[1])
                .map(([s, n]) => {
                  const meta = STATUS[s];
                  const Icon = meta.icon;
                  return (
                    <li key={s} className="grid grid-cols-[170px_minmax(0,1fr)_40px] items-center gap-3 text-sm">
                      <span className={cx('inline-flex items-center gap-1.5 font-medium', toneClasses[meta.tone].text)}>
                        <Icon className="h-4 w-4" aria-hidden />
                        {meta.short}
                      </span>
                      <span className="h-3 rounded-sm bg-muted">
                        <span className={cx('block h-3 rounded-sm', toneClasses[meta.tone].solid)} style={{ width: `${(n / max) * 100}%` }} />
                      </span>
                      <span className="text-end font-mono font-semibold">{n}</span>
                    </li>
                  );
                })}
            </ul>
          )}
        </Panel>
        <Panel title="Top risk flags">
          {a.top_flags.length === 0 ? (
            <p className="text-muted-foreground">No flags raised.</p>
          ) : (
            <ul className="divide-y divide-border">
              {a.top_flags.map((f) => (
                <li key={f.code} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-mono">{f.code}</span>
                  <span className="font-mono font-bold">{f.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

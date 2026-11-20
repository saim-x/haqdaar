import { useQuery } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import type { TenantAnalytics } from '../../shared/api/types';
import { Card, CardTitle, ErrorState, Kpi, Loading, PageHeader } from '../ui';

/** Tenant analytics — docs/11 §6.4. Always tenant-filtered server-side (AC-02.2). */
export default function AnalyticsPage() {
  const query = useQuery({
    queryKey: ['tenant-analytics'],
    queryFn: () => api.get<TenantAnalytics>('/analytics/tenant'),
    staleTime: 60_000,
  });

  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorState error={query.error} />;
  if (!query.data) return <ErrorState error={new Error('No analytics')} />;

  const data = query.data;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tenant analytics"
        subtitle={`${data.total_cases} cases · ${data.decided_cases} decided · tenant ${data.tenant_id.slice(0, 8)}`}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Disbursed" value={`PKR ${data.disbursed_pkr.toLocaleString()}`} />
        <Kpi label="Auto-approve" value={`${data.auto_approve_pct.toFixed(1)}%`} />
        <Kpi label="Avg time to decision" value={`${(data.avg_time_to_decision_seconds / 3600).toFixed(1)}h`} />
        <Kpi label="Open cases" value={String(data.open_cases)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Cases by status</CardTitle>
          <ul className="space-y-1">
            {Object.entries(data.cases_by_status).map(([status, count]) => (
              <li key={status} className="flex items-center justify-between text-xs">
                <span className="font-mono text-ink-soft">{status}</span>
                <span className="num font-bold text-ink">{count}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardTitle>Top risk flags</CardTitle>
          <ul className="space-y-1">
            {data.top_flags.map((flag) => (
              <li key={flag.code} className="flex items-center justify-between text-xs">
                <span className="font-mono text-ink-soft">{flag.code}</span>
                <span className="num font-bold text-ink">{flag.count}</span>
              </li>
            ))}
            {data.top_flags.length === 0 && <li className="text-xs text-ink-soft">No flags recorded.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

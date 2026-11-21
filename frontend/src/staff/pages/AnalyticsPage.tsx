import { useQuery } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import type { TenantAnalytics } from '../../shared/api/types';
import { Card, ErrorState, Kpi, Loading, PageHeader } from '../ui';

/**
 * Status enums are contract values, not words. The console shows the word and
 * keeps the enum for the API — an officer reading "HUMAN_REVIEW" has to decode
 * it, and a screen full of shouting snake_case has no hierarchy left.
 */
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  PROCESSING: 'Processing',
  HUMAN_REVIEW: 'Human review',
  WAIT_EXTERNAL: 'Waiting on external',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PAID: 'Paid',
  WITHDRAWN: 'Withdrawn',
  ON_HOLD_CONSENT: 'On hold — consent',
  ESCALATED: 'Escalated',
};

const statusWord = (status: string) =>
  STATUS_LABEL[status] ?? status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');

/**
 * Tenant analytics — docs/11 §6.4. Always tenant-filtered server-side (AC-02.2).
 *
 * Two ledgers, not two pie charts. A count next to a proportional hairline bar
 * answers "which status dominates" faster than any chart, and it stays readable
 * when the numbers are 3 and 1.
 */
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
  const statusRows = Object.entries(data.cases_by_status).sort((a, b) => b[1] - a[1]);
  const statusMax = Math.max(...statusRows.map(([, count]) => count), 1);
  const flagRows = data.top_flags;
  const flagMax = Math.max(...flagRows.map((flag) => flag.count), 1);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tenant analytics"
        subtitle={`${data.total_cases} cases · ${data.decided_cases} decided`}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Disbursed" value={`PKR ${data.disbursed_pkr.toLocaleString()}`} />
        <Kpi label="Auto-approve" value={`${data.auto_approve_pct.toFixed(1)}%`} />
        <Kpi
          label="Avg time to decision"
          value={`${(data.avg_time_to_decision_seconds / 3600).toFixed(1)}h`}
        />
        <Kpi label="Open cases" value={String(data.open_cases)} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card className="p-0">
          <div className="border-b border-ink/[0.08] px-4 py-3">
            <h2 className="text-body font-medium text-ink">Cases by status</h2>
          </div>
          <table className="ledger">
            <tbody>
              {statusRows.map(([status, count]) => (
                <tr key={status}>
                  <td className="w-[46%] text-caption text-ink">{statusWord(status)}</td>
                  <td>
                    <span className="block h-0.5 w-full overflow-hidden rounded-full bg-ink/[0.08]">
                      <span
                        className="block h-full bg-accent"
                        style={{ width: `${Math.round((count / statusMax) * 100)}%` }}
                      />
                    </span>
                  </td>
                  <td className="num w-16 text-end font-mono font-medium text-ink">{count}</td>
                </tr>
              ))}
              {statusRows.length === 0 && (
                <tr>
                  <td className="text-caption text-ink-3">No cases yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        <Card className="p-0">
          <div className="border-b border-ink/[0.08] px-4 py-3">
            <h2 className="text-body font-medium text-ink">Top risk flags</h2>
          </div>
          <table className="ledger">
            <tbody>
              {flagRows.map((flag) => (
                <tr key={flag.code}>
                  <td className="w-[46%] font-mono text-meta text-ink-2">{flag.code}</td>
                  <td>
                    <span className="block h-0.5 w-full overflow-hidden rounded-full bg-ink/[0.08]">
                      <span
                        className="block h-full bg-warn"
                        style={{ width: `${Math.round((flag.count / flagMax) * 100)}%` }}
                      />
                    </span>
                  </td>
                  <td className="num w-16 text-end font-mono font-medium text-ink">{flag.count}</td>
                </tr>
              ))}
              {flagRows.length === 0 && (
                <tr>
                  <td className="text-caption text-ink-3">No flags recorded.</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

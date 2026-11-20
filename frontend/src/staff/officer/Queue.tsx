import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, Lock, RefreshCw, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { officer } from '../../shared/api/endpoints';
import type { QueueCard } from '../../shared/api/types';
import { timeAgo } from '../../shared/i18n';
import { Button } from '../../shared/ui/Button';
import { cx } from '../../shared/ui/cx';
import { PageLoader } from '../../shared/ui/Spinner';
import { Table, TableBody, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { ConfidenceBar, EmptyState, ErrorState, FlagChip, PageHeader, PriorityBadge, ReasonChip } from '../ui';

const SORTS = [
  { id: 'priority', label: 'Priority' },
  { id: 'confidence_asc', label: 'Lowest confidence' },
  { id: 'oldest', label: 'Oldest' },
] as const;

const FILTERS = [
  { id: 'all', label: 'All open', params: {} },
  { id: 'unassigned', label: 'Unassigned', params: { assigned: 'unassigned' } },
  { id: 'me', label: 'Assigned to me', params: { assigned: 'me' } },
  { id: 'second', label: 'Awaiting 2nd approval', params: { status: 'PENDING_SECOND_APPROVAL' } },
  { id: 'high', label: 'HIGH flags', params: { flag: 'HIGH' } },
  { id: 'payment', label: 'Payment failed', params: { status: 'PAYMENT_FAILED' } },
] as const;

/** Officer review queue (docs/11 §6.1, F-07). Server-side sorting and filtering. */
export function Queue() {
  const [sort, setSort] = useState<(typeof SORTS)[number]['id']>('priority');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const nav = useNavigate();
  const params = FILTERS.find((f) => f.id === filter)!.params;
  const q = useQuery({
    queryKey: ['queue', sort, filter],
    queryFn: async () => {
      const r = await officer.queue({ sort, limit: 100, ...params });
      return Array.isArray(r) ? { items: r, total: r.length } : r;
    },
    refetchInterval: 10000,
  });

  const items: QueueCard[] = q.data?.items ?? [];
  const lead = sort === 'priority' ? items[0] : undefined;
  const rest = lead ? items.slice(1) : items;

  return (
    <div>
      <PageHeader
        eyebrow="Officer workspace"
        title="Review queue"
        subtitle="Every case here is one the system refused to decide alone. Sorted server-side; confidence bars show the 0.90 auto-approve line."
        actions={
          <Button variant="secondary" size="sm" onClick={() => void q.refetch()} loading={q.isFetching} icon={<RefreshCw className="h-4 w-4" aria-hidden />}>
            Refresh
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
          <TabsList className="h-10 rounded-lg">
            {SORTS.map((x) => (
              <TabsTrigger key={x.id} value={x.id} className="rounded-md px-3 text-sm font-semibold">
                {x.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap gap-1.5" aria-label="Filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cx(
                'min-h-[32px] rounded-full border px-3 text-xs font-semibold',
                filter === f.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-input hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="ms-auto text-sm text-muted-foreground">{q.data ? `${q.data.total} cases` : ''}</span>
      </div>

      {q.isLoading ? (
        <PageLoader />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : items.length === 0 ? (
        <EmptyState title="Queue is clear" body="No cases match this filter. New escalations appear here automatically every 10 seconds." />
      ) : (
        <div className="space-y-3">
          {lead && (
            <Link
              to={`/staff/cases/${lead.id}`}
              className="group relative block overflow-hidden rounded-xl border border-danger/30 bg-gradient-to-br from-danger-soft/70 via-card to-card p-5 transition-shadow duration-fast hover:shadow-lift"
              aria-label={`Top priority case ${lead.reference_code}`}
            >
              <div className="flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold uppercase tracking-wider text-danger">Start here · highest priority</p>
                  <p className="mt-1 text-2xl font-bold">
                    <span className="font-mono">{lead.reference_code}</span> <span className="text-muted-foreground">·</span> {lead.applicant_name}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <PriorityBadge band={lead.priority_band} score={lead.priority_score} />
                    <StatusBadge status={lead.status} variant="staff" />
                    {lead.flags.map((f) => (
                      <FlagChip key={f.code} flag={f} />
                    ))}
                  </div>
                </div>
                <div className="w-56">
                  <ConfidenceBar value={lead.latest_confidence} label="Weakest-link confidence" />
                  <p className="mt-2 text-xs text-muted-foreground">Waiting {timeAgo(lead.submitted_at)}</p>
                </div>
              </div>
            </Link>
          )}

          {rest.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="relative overflow-x-auto">
                <Table className="min-w-[900px]">
                  <caption className="sr-only">Cases awaiting review</caption>
                  <TableHeader className="bg-muted/60 [&_th]:text-start [&_th]:h-10 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                    <TableRow className="border-border hover:bg-transparent">
                      <th className="px-3 py-2 font-semibold">Priority</th>
                      <th className="px-3 py-2 font-semibold">Reference · applicant</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 font-semibold">Why it is here</th>
                      <th className="px-3 py-2 font-semibold">Confidence</th>
                      <th className="px-3 py-2 font-semibold">Waiting</th>
                      <th className="px-3 py-2 font-semibold">Assigned</th>
                      <th className="px-3 py-2">
                        <span className="sr-only">Open</span>
                      </th>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rest.map((c) => (
                      <TableRow key={c.id} className="cursor-pointer border-border hover:bg-muted/60" onClick={() => nav(`/staff/cases/${c.id}`)}>
                        <td className="px-3 py-3">
                          <PriorityBadge band={c.priority_band} score={c.priority_score} />
                        </td>
                        <td className="px-3 py-3">
                          <Link to={`/staff/cases/${c.id}`} className="font-mono font-semibold text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                            {c.reference_code}
                          </Link>
                          <p className="flex items-center gap-1 text-muted-foreground">
                            {c.status === 'ON_HOLD_CONSENT' && <Lock className="h-3.5 w-3.5 text-consent" aria-hidden />}
                            {c.applicant_name} <span className="font-mono text-xs">{c.cnic_masked}</span>
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge status={c.status} variant="staff" />
                          {c.rule_stale && (
                            <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-warn" title="Evaluated with an older rule version">
                              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                              Rule v{c.rule_version_number} (stale)
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex max-w-[280px] flex-wrap gap-1">
                            {c.flags.length ? c.flags.map((f) => <FlagChip key={f.code} flag={f} />) : c.reason_codes.slice(0, 3).map((r) => <ReasonChip key={r} code={r} />)}
                          </div>
                        </td>
                        <td className="w-40 px-3 py-3">
                          <ConfidenceBar value={c.latest_confidence} compact />
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">{timeAgo(c.submitted_at)}</td>
                        <td className="px-3 py-3">
                          {c.status === 'PENDING_SECOND_APPROVAL' ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-info">
                              <Users className="h-3.5 w-3.5" aria-hidden />
                              Needs 2nd officer
                            </span>
                          ) : (
                            c.assigned_officer?.full_name ?? <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          <ChevronRight className="h-4 w-4" aria-hidden />
                        </td>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="pointer-events-none absolute inset-y-0 end-0 w-8 bg-gradient-to-l from-card to-transparent lg:hidden" aria-hidden />
              </div>
              <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                {items.length} open · the table scrolls sideways on small screens
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

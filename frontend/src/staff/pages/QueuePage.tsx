import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import type { QueueItem, QueueResponse } from '../../shared/api/types';
import { Card, Chip, ConfidenceBar, EmptyState, ErrorState, Loading, PageHeader, PriorityBand } from '../ui';
import { IconRefresh, IconWarning } from '../../shared/ui/Icons';

type Sort = 'priority' | 'confidence_asc' | 'oldest';

const SORTS: { key: Sort; label: string }[] = [
  { key: 'priority', label: 'Priority' },
  { key: 'confidence_asc', label: 'Lowest confidence' },
  { key: 'oldest', label: 'Oldest' },
];

const STATUS_FILTERS = ['', 'HUMAN_REVIEW', 'IN_REVIEW', 'PENDING_SECOND_APPROVAL', 'NEEDS_INFO', 'WAITING_EXTERNAL'];

function waitingFor(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.max(Math.floor(ms / 60000), 0);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Officer queue — docs/11 §6.1 / AC-07.1.
 * Sorting and filtering are server-side so the queue is correct at any page size.
 */
export default function QueuePage() {
  const [sort, setSort] = useState<Sort>('priority');
  const [status, setStatus] = useState('');
  const [assigned, setAssigned] = useState<'all' | 'me' | 'unassigned'>('all');
  const [secondApproval, setSecondApproval] = useState(false);

  const params = new URLSearchParams({ sort, assigned, limit: '50' });
  if (status) params.set('status', status);
  if (secondApproval) params.set('status', 'PENDING_SECOND_APPROVAL');

  const query = useQuery({
    queryKey: ['officer-queue', sort, status, assigned, secondApproval],
    queryFn: () => api.get<QueueResponse>(`/officer/queue?${params.toString()}`),
    refetchInterval: 20_000,
  });

  return (
    <div>
      <PageHeader
        title="Review queue"
        subtitle="Sorted server-side. Priority is the default; nothing here can auto-reject."
        actions={
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-3 text-xs font-semibold text-ink-soft hover:bg-ink/5"
          >
            <IconRefresh size={14} />
            Refresh
          </button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-ink/15 bg-white" role="tablist">
          {SORTS.map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={sort === key}
              onClick={() => setSort(key)}
              className={`min-h-tap px-3 text-xs font-semibold ${
                sort === key ? 'bg-teal-600 text-white' : 'text-ink-soft hover:bg-ink/5'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="min-h-tap rounded-lg border border-ink/15 bg-white px-2 text-xs font-semibold text-ink"
          aria-label="Filter by status"
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === '' ? 'All statuses' : s}
            </option>
          ))}
        </select>

        <select
          value={assigned}
          onChange={(e) => setAssigned(e.target.value as typeof assigned)}
          className="min-h-tap rounded-lg border border-ink/15 bg-white px-2 text-xs font-semibold text-ink"
          aria-label="Filter by assignment"
        >
          <option value="all">Everyone</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
        </select>

        <label className="inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-2 text-xs font-semibold text-ink-soft">
          <input type="checkbox" checked={secondApproval} onChange={(e) => setSecondApproval(e.target.checked)} />
          Awaiting 2nd approval
        </label>
      </div>

      {query.isLoading && <Loading />}
      {query.error && <ErrorState error={query.error} />}
      {query.data && query.data.items.length === 0 && <EmptyState>No cases match these filters.</EmptyState>}

      {query.data && query.data.items.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                <th className="px-3 py-2">Priority</th>
                <th className="px-3 py-2">Reference</th>
                <th className="px-3 py-2">Applicant</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Reasons</th>
                <th className="px-3 py-2">Confidence</th>
                <th className="px-3 py-2">Waiting</th>
                <th className="px-3 py-2">Officer</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((item: QueueItem) => (
                <tr key={item.id} className="border-b border-ink/5 last:border-0 hover:bg-teal-50/40">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <PriorityBand band={item.priority_band} />
                      <span className="num text-[11px] text-ink-soft">{item.priority_score}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Link to={`/staff/cases/${item.id}`} className="font-mono text-xs font-semibold text-teal-700 hover:underline">
                      {item.reference_code}
                    </Link>
                    {item.rule_stale && (
                      <span
                        className="ms-1.5 inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-bold text-amber-700"
                        title="Evaluated with an older rule version — re-evaluate before deciding"
                      >
                        <IconWarning size={10} />
                        stale
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <p className="font-semibold text-ink">{item.citizen_name}</p>
                    <p className="num text-[11px] text-ink-soft">{item.cnic_masked}</p>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-soft">{item.status}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {item.reason_codes.slice(0, 2).map((code) => (
                        <Chip key={code} tone="danger">
                          {code}
                        </Chip>
                      ))}
                      {item.reason_codes.length > 2 && <Chip>+{item.reason_codes.length - 2}</Chip>}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <ConfidenceBar value={item.latest_confidence} />
                  </td>
                  <td className="num px-3 py-2 text-xs text-ink-soft">{waitingFor(item.submitted_at ?? item.created_at)}</td>
                  <td className="px-3 py-2 text-xs text-ink-soft">{item.assigned_officer_id ? 'assigned' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

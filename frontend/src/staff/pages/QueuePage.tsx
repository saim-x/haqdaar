import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import type { QueueItem, QueueResponse } from '../../shared/api/types';
import {
  Card,
  Chip,
  ConfidenceBar,
  EmptyState,
  ErrorState,
  humanize,
  Loading,
  PageHeader,
  PriorityBand,
  statusWord,
} from '../ui';
import { IconRefresh, IconWarning } from '../../shared/ui/Icons';

type Sort = 'priority' | 'confidence_asc' | 'oldest';

const SORTS: { key: Sort; label: string }[] = [
  { key: 'priority', label: 'Priority' },
  { key: 'confidence_asc', label: 'Lowest confidence' },
  { key: 'oldest', label: 'Oldest' },
];

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'HUMAN_REVIEW', label: 'With an officer' },
  { value: 'IN_REVIEW', label: 'In review' },
  { value: 'PENDING_SECOND_APPROVAL', label: 'Awaiting 2nd approval' },
  { value: 'NEEDS_INFO', label: 'Needs more information' },
  { value: 'WAITING_EXTERNAL', label: 'Waiting on a registry' },
];

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
 *
 * The queue is a ledger: one row per case, hairline rules, tabular figures. The
 * reference code is the only link, because that is what an officer reads out
 * loud when two people are looking at the same screen.
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
            className="press inline-flex min-h-[36px] items-center gap-1.5 rounded-control border border-ink/[0.14] bg-card px-3 text-caption text-ink-2 hover:bg-raised hover:text-ink"
          >
            <IconRefresh size={14} />
            Refresh
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex gap-1 rounded-control bg-raised p-1" role="tablist">
          {SORTS.map(({ key, label }) => {
            const selected = sort === key;
            return (
              <button
                key={key}
                role="tab"
                aria-selected={selected}
                onClick={() => setSort(key)}
                className={`press min-h-[32px] rounded-[7px] px-2.5 text-meta ${
                  selected ? 'bg-card font-medium text-ink shadow-hair' : 'text-ink-2 hover:text-ink'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="min-h-[36px] w-auto rounded-control border border-ink/[0.14] bg-card px-2 text-meta text-ink"
          aria-label="Filter by status"
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <select
          value={assigned}
          onChange={(e) => setAssigned(e.target.value as typeof assigned)}
          className="min-h-[36px] w-auto rounded-control border border-ink/[0.14] bg-card px-2 text-meta text-ink"
          aria-label="Filter by assignment"
        >
          <option value="all">Everyone</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
        </select>

        <label className="inline-flex min-h-[36px] items-center gap-2 rounded-control border border-ink/[0.14] bg-card px-2.5 text-meta text-ink-2">
          <input
            type="checkbox"
            checked={secondApproval}
            onChange={(e) => setSecondApproval(e.target.checked)}
            className="h-4 w-4 accent-[#0F766E]"
          />
          Awaiting 2nd approval
        </label>
      </div>

      {query.isLoading && <Loading />}
      {query.error && <ErrorState error={query.error} />}
      {query.data && query.data.items.length === 0 && (
        <EmptyState>No cases match these filters.</EmptyState>
      )}

      {query.data && query.data.items.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="ledger min-w-[900px]">
            <thead>
              <tr>
                <th>Priority</th>
                <th>Reference</th>
                <th>Applicant</th>
                <th>Status</th>
                <th>Reasons</th>
                <th>Confidence</th>
                <th className="text-end">Waiting</th>
                <th>Officer</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((item: QueueItem) => (
                <tr key={item.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <PriorityBand band={item.priority_band} />
                      <span className="num font-mono text-meta text-ink-3">
                        {item.priority_score}
                      </span>
                    </div>
                  </td>
                  <td>
                    <Link
                      to={`/staff/cases/${item.id}`}
                      className="whitespace-nowrap font-mono text-caption font-medium text-accent-ink hover:underline"
                    >
                      {item.reference_code}
                    </Link>
                    {item.rule_stale && (
                      <span
                        className="ms-1.5 inline-flex items-center gap-0.5 text-meta text-warn"
                        title="Evaluated with an older rule version — re-evaluate before deciding"
                      >
                        <IconWarning size={11} />
                        stale
                      </span>
                    )}
                  </td>
                  <td>
                    <p className="whitespace-nowrap text-caption font-medium text-ink">
                      {item.citizen_name}
                    </p>
                    <p className="num whitespace-nowrap font-mono text-meta text-ink-3">
                      {item.cnic_masked}
                    </p>
                  </td>
                  <td className="whitespace-nowrap text-meta text-ink-2">
                    {item.status_label?.label_en ?? statusWord(item.status)}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {item.reason_codes.slice(0, 2).map((code) => (
                        <Chip key={code} title={code}>
                          {humanize(code)}
                        </Chip>
                      ))}
                      {item.reason_codes.length > 2 && <Chip>+{item.reason_codes.length - 2}</Chip>}
                    </div>
                  </td>
                  <td>
                    <ConfidenceBar value={item.latest_confidence} />
                  </td>
                  <td className="num text-end font-mono text-meta text-ink-2">
                    {waitingFor(item.submitted_at ?? item.created_at)}
                  </td>
                  <td className="whitespace-nowrap text-meta text-ink-3">
                    {item.assigned_officer_id ? 'Assigned' : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

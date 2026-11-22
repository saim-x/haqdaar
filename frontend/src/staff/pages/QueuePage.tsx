import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { errorMessage } from '../../shared/api/errors';
import { useAuth } from '../../shared/auth/AuthProvider';
import type { QueueItem, QueueResponse } from '../../shared/api/types';
import { staffText } from '../staffI18n';
import {
  Card,
  Chip,
  ConfidenceBar,
  EmptyState,
  ErrorState,
  factLabel,
  flagWord,
  Loading,
  PageHeader,
  PriorityBand,
  statusWord,
} from '../ui';
import { IconArrowRight, IconRefresh } from '../../shared/ui/Icons';

interface PendingCorrectionItem {
  id: string;
  citizen_id: string;
  citizen_name: string | null;
  field_key: string;
  source_type: string;
  old_value: { value?: unknown } | unknown;
  requested_value: { value?: unknown } | unknown;
  reason: string | null;
  status: string;
  created_at: string | null;
}

interface CorrectionsListResponse {
  items: PendingCorrectionItem[];
  total: number;
}

function unwrapVal(v: unknown): string {
  if (v && typeof v === 'object' && 'value' in v) {
    const inner = (v as { value?: unknown }).value;
    return inner === null || inner === undefined ? '-' : String(inner);
  }
  return v === null || v === undefined ? '-' : String(v);
}

type Sort = 'priority' | 'confidence_asc' | 'oldest';

const SORTS: { key: Sort; label: string }[] = [
  { key: 'priority', label: 'Priority' },
  { key: 'confidence_asc', label: 'Needs more checking' },
  { key: 'oldest', label: 'Oldest' },
];

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All case statuses' },
  { value: 'HUMAN_REVIEW', label: 'Ready to review' },
  { value: 'IN_REVIEW', label: 'In review' },
  { value: 'PENDING_SECOND_APPROVAL', label: 'Needs a second approval' },
  { value: 'NEEDS_INFO', label: 'Needs more information' },
  { value: 'WAITING_EXTERNAL', label: 'Waiting on a registry' },
];

function waitingFor(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.max(Math.floor(ms / 60000), 0);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

export default function QueuePage() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const [showWorkload, setShowWorkload] = useState(false);
  const [sort, setSort] = useState<Sort>('priority');
  const [status, setStatus] = useState('');
  const [assigned, setAssigned] = useState<'all' | 'me' | 'unassigned'>('all');
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  const params = new URLSearchParams({ sort, assigned, limit: '50' });
  if (status) params.set('status', status);

  const query = useQuery({
    queryKey: ['officer-queue', sort, status, assigned],
    queryFn: () => api.get<QueueResponse>(`/officer/queue?${params.toString()}`),
    refetchInterval: 20_000,
  });

  const corrections = useQuery({
    queryKey: ['officer-corrections'],
    queryFn: () => api.get<CorrectionsListResponse>('/officer/corrections?status=PENDING_OFFICER'),
    refetchInterval: 30_000,
  });

  const workload = useQuery({
    queryKey: ['officer-queue', 'workload'],
    enabled: showWorkload,
    queryFn: async ({ signal }) => {
      const seen = new Set<string>();
      const grouped = new Map<string, { count: number; oldest: string }>();
      const limit = 100;
      for (let offset = 0; ; offset += limit) {
        const page = await api.get<QueueResponse>(
          `/officer/queue?assigned=all&sort=oldest&limit=${limit}&offset=${offset}`,
          { signal },
        );
        for (const item of page.items) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          const key = item.assigned_officer_id ?? '';
          const since = item.submitted_at ?? item.created_at;
          const entry = grouped.get(key);
          grouped.set(key, {
            count: (entry?.count ?? 0) + 1,
            oldest: entry && Date.parse(entry.oldest) < Date.parse(since) ? entry.oldest : since,
          });
        }
        if (!page.items.length || offset + page.items.length >= page.total) break;
      }
      return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
    },
  });

  const resolveCorrection = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'APPROVE' | 'REJECT' }) =>
      api.post(`/officer/corrections/${id}/resolve`, { decision }),
    onSuccess: () => {
      setCorrectionError(null);
      void qc.invalidateQueries({ queryKey: ['officer-corrections'] });
    },
    onError: (err) => setCorrectionError(errorMessage(err, 'en')),
  });

  return (
    <div>
      <PageHeader
        title={staffText("Cases to review")}
        subtitle={staffText("Open a case to check the application and record your decision.")}
        actions={
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="press inline-flex min-h-[36px] items-center gap-1.5 rounded-control border border-ink/[0.14] bg-card px-3 text-caption text-ink-2 hover:bg-raised hover:text-ink"
          >
            <IconRefresh size={14} />
            {staffText("\r\n            Refresh\r\n          ")}</button>
        }
      />

      <details className="mb-4 rounded-panel border border-ink/[0.10] bg-card p-4" onToggle={(e) => setShowWorkload(e.currentTarget.open)}>
        <summary className="cursor-pointer font-medium text-ink">{staffText("Officer workload")}</summary>
        <p className="mt-2 text-caption text-ink-2">{staffText("Open cases in this department’s queue and how long the oldest has been waiting.")}</p>
        {workload.isLoading && <Loading label={staffText("Loading workload…")} />}
        {workload.error && <ErrorState error={workload.error} />}
        {workload.data?.length === 0 && <p className="mt-2 text-caption text-ink-2">{staffText("No open cases in the queue.")}</p>}
        <ul className="mt-2 space-y-2">
          {workload.data?.map(([officerId, entry]) => (
            <li key={officerId} className="flex flex-wrap items-center justify-between gap-2 text-caption">
              <span className="font-medium">{!officerId ? 'Unassigned' : officerId === session?.user.id ? 'My cases' : `Officer ${officerId.slice(0, 8)}`}</span>
              <span>{entry.count} {staffText(" open · oldest submitted ")}{waitingFor(entry.oldest)}</span>
            </li>
          ))}
        </ul>
      </details>

      <div data-tour="queue-filters" className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap gap-1 rounded-control bg-raised p-1" role="group" aria-label={staffText("Sort cases")}>
          {SORTS.map(({ key, label }) => {
            const selected = sort === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={selected}
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
          aria-label={staffText("Filter by status")}
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
          aria-label={staffText("Filter by assignment")}
        >
          <option value="all">{staffText("All officers")}</option>
          <option value="me">{staffText("My cases")}</option>
          <option value="unassigned">{staffText("Ready for an officer")}</option>
        </select>

      </div>

      {query.isLoading && <Loading />}
      {query.error && <ErrorState error={query.error} />}
      {query.data && query.data.items.length === 0 && (
        <EmptyState>{staffText("No cases match these filters.")}</EmptyState>
      )}

      {query.data && query.data.items.length > 0 && (
        <ul className="space-y-2" aria-label={staffText("Cases to review")}>
          {query.data.items.map((item: QueueItem) => (
            <li key={item.id}>
              <Link
                to={`/staff/cases/${item.id}`}
                className="press grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 rounded-panel border border-ink/[0.10] bg-card px-4 py-3 shadow-hair hover:border-accent/40 hover:bg-accent-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent sm:grid-cols-[minmax(0,1fr)_minmax(9rem,auto)_auto]"
              >
                <div className="min-w-0">
                  <p className="break-words text-body font-semibold text-ink">{item.citizen_name || 'Applicant'}</p>
                  <p className="mt-1 text-meta text-ink-2">{item.reference_code} {staffText(" · ")}{item.program?.name ?? 'Application'}</p>
                  {item.reason_codes?.length > 0 && (
                    <p className="mt-1 text-meta text-ink-2">
                      {item.reason_codes.slice(0, 2).map(flagWord).join(' · ')}
                    </p>
                  )}
                </div>
                <div className="col-start-1 row-start-2 flex flex-wrap items-center gap-2 sm:col-start-auto sm:row-start-auto">
                  <Chip tone="info">{statusWord(item.status)}</Chip>
                  <PriorityBand band={item.priority_band} />
                  {item.rule_stale && <Chip tone="warn">{staffText("Needs a fresh check")}</Chip>}
                  <span className="text-meta text-ink-3">{staffText("Submitted ")}{waitingFor(item.submitted_at ?? item.created_at)}</span>
                  {sort === 'confidence_asc' && (
                    <span className="inline-flex items-center gap-1 text-meta text-ink-3">
                      {staffText("\r\n                      Record confidence ")}<ConfidenceBar value={item.latest_confidence} />
                    </span>
                  )}
                </div>
                <span className="col-start-2 row-span-2 row-start-1 inline-flex items-center gap-2 text-caption font-medium text-accent-ink sm:col-start-auto sm:row-span-1 sm:row-start-auto">
                  <span className="hidden sm:inline">{staffText("Open case")}</span>
                  <IconArrowRight size={18} aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {corrections.data && corrections.data.items.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-caption font-semibold uppercase tracking-wide text-ink-3">
            {staffText("\r\n            Requests to correct citizen records (")}{corrections.data.items.length}{staffText(")\r\n          ")}</h2>
          {correctionError && (
            <p className="mb-2 text-caption text-danger" role="alert">
              {correctionError}
            </p>
          )}
          <Card className="overflow-x-auto p-0">
            <table className="ledger min-w-[760px]">
              <thead>
                <tr>
                  <th>{staffText("Citizen")}</th>
                  <th>{staffText("Field")}</th>
                  <th>{staffText("Current")}</th>
                  <th>{staffText("Requested")}</th>
                  <th>{staffText("Reason")}</th>
                  <th className="text-end">{staffText("Action")}</th>
                </tr>
              </thead>
              <tbody>
                {corrections.data.items.map((c) => (
                  <tr key={c.id}>
                    <td className="font-medium text-ink">{c.citizen_name ?? 'Name unavailable'}</td>
                    <td className="text-meta text-ink-2">{factLabel(c.field_key)}</td>
                    <td className="text-meta text-ink-3">{unwrapVal(c.old_value)}</td>
                    <td className="text-meta font-medium text-ink">
                      {unwrapVal(c.requested_value)}
                    </td>
                    <td className="text-meta text-ink-2">{c.reason ?? '-'}</td>
                    <td className="text-end">
                      <div className="inline-flex gap-1.5">
                        <button
                          type="button"
                          disabled={resolveCorrection.isPending}
                          onClick={() =>
                            resolveCorrection.mutate({ id: c.id, decision: 'APPROVE' })
                          }
                          className="press rounded-control bg-accent px-2.5 py-1 text-meta font-medium text-white disabled:opacity-40"
                        >
                          {staffText("\r\n                          Approve\r\n                        ")}</button>
                        <button
                          type="button"
                          disabled={resolveCorrection.isPending}
                          onClick={() =>
                            resolveCorrection.mutate({ id: c.id, decision: 'REJECT' })
                          }
                          className="press rounded-control border border-ink/[0.14] bg-card px-2.5 py-1 text-meta text-ink-2 hover:text-danger disabled:opacity-40"
                        >
                          {staffText("\r\n                          Reject\r\n                        ")}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}

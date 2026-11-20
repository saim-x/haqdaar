import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCw } from 'lucide-react';
import { useState } from 'react';
import { admin } from '../../shared/api/endpoints';
import type { JobStatus } from '../../shared/api/types';
import { Button } from '../../shared/ui/Button';
import { cx } from '../../shared/ui/cx';
import { PageLoader } from '../../shared/ui/Spinner';
import { EmptyState, ErrorState, fmtTime, PageHeader } from '../ui';

const TONE: Record<JobStatus, string> = {
  PENDING: 'bg-info-soft text-info',
  RUNNING: 'bg-info text-white',
  COMPLETED: 'bg-ok-soft text-ok',
  FAILED_RETRY: 'bg-warn-soft text-warn',
  DEAD: 'bg-danger text-white',
};

/** Postgres SKIP LOCKED job queue viewer with retry for DEAD jobs. */
export function JobsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<JobStatus | ''>('');
  const q = useQuery({ queryKey: ['jobs', status], queryFn: () => admin.jobs(status || undefined), refetchInterval: 4000 });
  const retry = useMutation({ mutationFn: admin.retryJob, onSuccess: () => void qc.invalidateQueries({ queryKey: ['jobs'] }) });

  return (
    <div>
      <PageHeader eyebrow="Administration" title="Background jobs" subtitle="Case processing, payments, document checks and RAG re-indexing run on a transactional Postgres queue with exponential back-off." />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {(['', 'PENDING', 'RUNNING', 'FAILED_RETRY', 'DEAD', 'COMPLETED'] as const).map((s) => (
          <button
            key={s || 'all'}
            type="button"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
            className={cx('min-h-[32px] rounded-full border px-3 text-xs font-semibold', status === s ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface text-muted')}
          >
            {s || 'All'}
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <PageLoader />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : !q.data?.length ? (
        <EmptyState title="No jobs in this state" body="Submitting an application enqueues PROCESS_CASE; approvals enqueue INITIATE_PAYMENT." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">Jobs</caption>
            <thead className="bg-sunken text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Attempts</th>
                <th className="px-3 py-2">Payload</th>
                <th className="px-3 py-2">Last error</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {q.data.map((j) => (
                <tr key={j.id}>
                  <td className="px-3 py-2 font-mono text-xs font-semibold">{j.job_type}</td>
                  <td className="px-3 py-2">
                    <span className={cx('rounded px-1.5 py-0.5 text-xs font-bold', TONE[j.status])}>{j.status}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {j.attempts}/{j.max_attempts}
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-2 font-mono text-xs text-muted">{JSON.stringify(j.payload_json)}</td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-xs text-danger">{j.last_error ?? ''}</td>
                  <td className="px-3 py-2 text-xs text-muted">{fmtTime(j.created_at)}</td>
                  <td className="px-3 py-2 text-end">
                    {(j.status === 'DEAD' || j.status === 'FAILED_RETRY') && (
                      <Button size="sm" variant="secondary" icon={<RotateCw className="h-4 w-4" aria-hidden />} loading={retry.isPending && retry.variables === j.id} onClick={() => retry.mutate(j.id)}>
                        Retry
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

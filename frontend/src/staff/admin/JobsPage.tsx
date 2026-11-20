import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { errorMessage } from '../../shared/api/errors';
import type { JobListResponse, JobStatus } from '../../shared/api/types';
import { Card, Chip, ErrorState, Loading, PageHeader } from '../ui';

const STATUSES: (JobStatus | '')[] = ['', 'PENDING', 'RUNNING', 'FAILED_RETRY', 'DEAD', 'COMPLETED'];

const TONE: Record<string, 'ok' | 'warn' | 'danger' | 'info' | 'neutral'> = {
  PENDING: 'neutral',
  RUNNING: 'info',
  COMPLETED: 'ok',
  FAILED_RETRY: 'warn',
  DEAD: 'danger',
};

/** Jobs queue — docs/11 §6.2.4. Retry a DEAD job without touching the DB. */
export default function JobsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<JobStatus | ''>('');
  const [message, setMessage] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['admin-jobs', status],
    queryFn: () => api.get<JobListResponse>(`/admin/jobs${status ? `?status=${status}` : ''}`),
    refetchInterval: 10_000,
  });

  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/admin/jobs/${id}/retry`),
    onSuccess: () => {
      setMessage('Job re-queued.');
      void queryClient.invalidateQueries({ queryKey: ['admin-jobs'] });
    },
    onError: (err) => setMessage(errorMessage(err, 'en')),
  });

  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorState error={query.error} />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Jobs"
        subtitle="Postgres SKIP LOCKED queue — no Redis, no Celery."
        actions={
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as JobStatus | '')}
            className="min-h-tap rounded-lg border border-ink/15 bg-white px-2 text-xs font-semibold"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === '' ? 'All statuses' : s}
              </option>
            ))}
          </select>
        }
      />

      {message && <div className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-xs font-semibold text-ink">{message}</div>}

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-[11px] uppercase tracking-wide text-ink-soft">
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Attempts</th>
              <th className="px-3 py-2">Run after</th>
              <th className="px-3 py-2">Last error</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {query.data?.items.map((job) => (
              <tr key={job.id} className="border-b border-ink/5 last:border-0">
                <td className="px-3 py-2 font-mono text-xs font-semibold text-ink">{job.job_type}</td>
                <td className="px-3 py-2">
                  <Chip tone={TONE[job.status] ?? 'neutral'}>{job.status}</Chip>
                </td>
                <td className="num px-3 py-2 text-xs text-ink-soft">
                  {job.attempts}/{job.max_attempts}
                </td>
                <td className="num px-3 py-2 text-[11px] text-ink-soft">{new Date(job.run_after).toLocaleString()}</td>
                <td className="max-w-[240px] truncate px-3 py-2 text-[11px] text-ink-soft">{job.last_error ?? '—'}</td>
                <td className="px-3 py-2 text-right">
                  {job.status === 'DEAD' && (
                    <button
                      type="button"
                      onClick={() => retry.mutate(job.id)}
                      className="rounded border border-ink/15 px-2 py-1 text-[11px] font-semibold text-ink-soft hover:bg-ink/5"
                    >
                      Retry
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

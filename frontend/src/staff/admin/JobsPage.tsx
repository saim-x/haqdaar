import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { errorMessage } from '../../shared/api/errors';
import type { JobListResponse, JobStatus } from '../../shared/api/types';
import { Card, ErrorState, Loading, PageHeader } from '../ui';

const STATUSES: (JobStatus | '')[] = [
  '',
  'PENDING',
  'RUNNING',
  'FAILED_RETRY',
  'DEAD',
  'COMPLETED',
];

const TONE: Record<string, { dot: string; text: string }> = {
  PENDING: { dot: 'bg-ink-3', text: 'text-ink-2' },
  RUNNING: { dot: 'bg-info', text: 'text-info' },
  COMPLETED: { dot: 'bg-positive', text: 'text-positive' },
  FAILED_RETRY: { dot: 'bg-warn', text: 'text-warn' },
  DEAD: { dot: 'bg-negative', text: 'text-negative' },
};

const TONE_FALLBACK = { dot: 'bg-ink-3', text: 'text-ink-2' };

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
            aria-label="Filter by job status"
            onChange={(e) => setStatus(e.target.value as JobStatus | '')}
            className="field w-auto"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === '' ? 'All statuses' : s}
              </option>
            ))}
          </select>
        }
      />

      {message && (
        <div className="rounded-control border border-ink/[0.12] bg-card px-4 py-2.5 text-caption text-ink">
          {message}
        </div>
      )}

      <Card className="overflow-x-auto p-0">
        <table className="ledger min-w-[820px]">
          <thead>
            <tr>
              <th>Type</th>
              <th>Status</th>
              <th className="text-end">Attempts</th>
              <th>Run after</th>
              <th>Last error</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {query.data?.items.map((job) => {
              const tone = TONE[job.status] ?? TONE_FALLBACK;
              return (
                <tr key={job.id}>
                  <td className="font-mono text-meta font-medium text-ink">{job.job_type}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`live-dot ${tone.dot}`} aria-hidden />
                      <span className={`text-meta ${tone.text}`}>{job.status}</span>
                    </span>
                  </td>
                  <td className="num text-end font-mono text-meta text-ink-2">
                    {job.attempts}/{job.max_attempts}
                  </td>
                  <td className="num text-meta text-ink-3">
                    {new Date(job.run_after).toLocaleString()}
                  </td>
                  <td className="max-w-[260px] truncate text-meta text-ink-3">
                    {job.last_error ?? '—'}
                  </td>
                  <td className="text-end">
                    {job.status === 'DEAD' && (
                      <button
                        type="button"
                        onClick={() => retry.mutate(job.id)}
                        className="press min-h-[30px] rounded-[7px] border border-ink/[0.12] px-2 text-meta text-ink-2 hover:bg-raised hover:text-ink"
                      >
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {query.data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="text-caption text-ink-3">
                  No jobs in this state.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

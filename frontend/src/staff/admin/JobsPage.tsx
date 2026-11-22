import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, request } from '../../shared/api/client';
import { errorMessage } from '../../shared/api/errors';
import type { JobListResponse, JobStatus } from '../../shared/api/types';
import { Card, ErrorState, humanize, jobWord, Kpi, Loading, PageHeader } from '../ui';
import { staffText } from '../staffI18n';

interface HealthPayload {
  status: string;
  database: string;
  worker: string;
  uploads: string;
  detail?: {
    worker_heartbeat_stale?: boolean;
    ai_provider?: string;
    demo_mode?: boolean;
    embedded_worker?: boolean;
  };
}

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

function errorSummary(error: string | null): string {
  if (!error) return 'No error recorded.';
  const text = error.toLowerCase();
  if (text.includes('timeout') || text.includes('timed out')) return 'A service took too long to respond. The system may retry this job.';
  if (text.includes('connection') || text.includes('unavailable') || text.includes('refused')) return 'A required service could not be reached. Check service health, then retry if the job is stopped.';
  if (text.includes('consent')) return 'The required permission could not be confirmed. Review the citizen’s consent before retrying.';
  if (text.includes('not found') || text.includes('does not exist')) return 'A record needed for this task could not be found. Check that record before retrying.';
  return 'The task stopped because of an error. See technical details below.';
}

function payloadDetails(payload: Record<string, unknown>) {
  return Object.entries(payload).filter(([key, value]) =>
    /case_id|document_id|complaint_id|program_id|decision_id|rule_version_id|correlation_id|amount_pkr/.test(key)
    && (typeof value === 'string' || typeof value === 'number'),
  );
}

/** Jobs queue - docs/11 §6.2.4. Retry a DEAD job without touching the DB. */
export default function JobsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<JobStatus | ''>('');
  const [message, setMessage] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['admin-jobs', status],
    queryFn: () => api.get<JobListResponse>(`/admin/jobs${status ? `?status=${status}` : ''}`),
    refetchInterval: 10_000,
  });

  const health = useQuery({
    queryKey: ['system-health'],
    queryFn: () => request<HealthPayload>('/health', { base: '', anonymous: true }).then((r) => r.data),
    refetchInterval: 15_000,
  });

  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/admin/jobs/${id}/retry`),
    onMutate: (id) => setRetryingId(id),
    onSuccess: () => {
      setMessage('Job re-queued.');
      void queryClient.invalidateQueries({ queryKey: ['admin-jobs'] });
    },
    onError: (err) => setMessage(errorMessage(err, 'en')),
    onSettled: () => setRetryingId(null),
  });

  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorState error={query.error} />;

  return (
    <div className="space-y-4">
      <PageHeader
        title={staffText("Jobs")}
        subtitle={staffText("Postgres SKIP LOCKED queue - no Redis, no Celery.")}
        actions={
          <select
            value={status}
            aria-label={staffText("Filter by job status")}
            onChange={(e) => setStatus(e.target.value as JobStatus | '')}
            className="field w-auto"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === '' ? 'All statuses' : jobWord(s)}
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

      {health.data && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi
            label={staffText("System status")}
            value={health.data.status}
            hint={`AI: ${health.data.detail?.ai_provider ?? 'fake'}`}
          />
          <Kpi label={staffText("Database")} value={health.data.database} />
          <Kpi
            label={staffText("Worker heartbeat")}
            value={health.data.detail?.worker_heartbeat_stale ? 'Stale' : 'Fresh'}
            hint={health.data.worker}
          />
          <Kpi
            label={staffText("Pending / Running")}
            value={`${query.data?.queue_depth?.PENDING ?? 0} / ${query.data?.queue_depth?.RUNNING ?? 0}`}
            hint={staffText("Postgres SKIP LOCKED")}
          />
          <Kpi
            label={staffText("Completed / Dead")}
            value={`${query.data?.queue_depth?.COMPLETED ?? 0} / ${query.data?.queue_depth?.DEAD ?? 0}`}
            hint={`Retry: ${query.data?.queue_depth?.FAILED_RETRY ?? 0}`}
          />
        </div>
      )}

      <Card className="overflow-x-auto p-0">
        <table className="ledger min-w-[820px]">
          <thead>
            <tr>
              <th>{staffText("Task")}</th>
              <th>{staffText("Status")}</th>
              <th className="text-end">{staffText("Attempts")}</th>
              <th>{staffText("Next run")}</th>
              <th>{staffText("Issue")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {query.data?.items.map((job) => {
              const tone = TONE[job.status] ?? TONE_FALLBACK;
              return (
                <Fragment key={job.id}>
                <tr>
                  <td className="text-meta font-medium text-ink">{humanize(job.job_type)}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`live-dot ${tone.dot}`} aria-hidden />
                      <span className={`text-meta ${tone.text}`}>
                        {jobWord(job.status)}
                      </span>
                    </span>
                  </td>
                  <td className="num text-end font-mono text-meta text-ink-2">
                    {job.attempts}{staffText("/")}{job.max_attempts}
                  </td>
                  <td className="num text-meta text-ink-3">
                    {new Date(job.run_after).toLocaleString('en-GB', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="max-w-[260px] truncate text-meta text-ink-3">
                    {job.last_error ? errorSummary(job.last_error) : '-'}
                  </td>
                  <td className="text-end">
                    {job.status === 'DEAD' && (
                      <button
                        type="button"
                        onClick={() => retry.mutate(job.id)}
                        disabled={retryingId !== null}
                        className="press min-h-[30px] rounded-[7px] border border-ink/[0.12] px-2 text-meta text-ink-2 hover:bg-raised hover:text-ink"
                      >
                        {retryingId === job.id ? 'Retrying…' : 'Retry'}
                      </button>
                    )}
                  </td>
                </tr>
                <tr>
                  <td colSpan={6} className="py-0">
                    <details className="px-3 pb-2">
                      <summary className="min-h-9 cursor-pointer py-2 text-meta font-medium text-accent-ink">
                        {staffText("\r\n                        Show details\r\n                      ")}</summary>
                      <dl className="grid gap-x-5 gap-y-2 rounded-control bg-raised/60 p-3 text-meta sm:grid-cols-2">
                        <div>
                          <dt className="text-ink-3">{staffText("Created")}</dt>
                          <dd className="text-ink">{new Date(job.created_at).toLocaleString()}</dd>
                        </div>
                        <div>
                          <dt className="text-ink-3">{staffText("Last updated")}</dt>
                          <dd className="text-ink">{new Date(job.updated_at).toLocaleString()}</dd>
                        </div>
                        {job.locked_at && (
                          <div>
                            <dt className="text-ink-3">{staffText("Picked up by worker")}</dt>
                            <dd className="text-ink">{new Date(job.locked_at).toLocaleString()}</dd>
                          </div>
                        )}
                        <div>
                          <dt className="text-ink-3">{staffText("Attempts")}</dt>
                          <dd className="text-ink">{job.attempts} {staffText(" of ")}{job.max_attempts}</dd>
                        </div>
                        {payloadDetails(job.payload ?? {}).map(([key, value]) => (
                          <div key={key} className="min-w-0">
                            <dt className="text-ink-3">{humanize(key)}</dt>
                            <dd className="break-all font-mono text-ink">{String(value)}</dd>
                          </div>
                        ))}
                        {job.last_error && (
                          <div className="sm:col-span-2">
                            <dt className="text-ink-3">{staffText("Technical error")}</dt>
                            <dd className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-control bg-card p-2 font-mono text-meta text-ink">
                              {job.last_error}
                            </dd>
                          </div>
                        )}
                      </dl>
                    </details>
                  </td>
                </tr>
                </Fragment>
              );
            })}
            {query.data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="text-caption text-ink-3">
                  {staffText("\r\n                  No jobs in this state.\r\n                ")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

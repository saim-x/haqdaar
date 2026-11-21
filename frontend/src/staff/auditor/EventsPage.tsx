import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { errorMessage } from '../../shared/api/errors';
import type { AuditEventList, ChainVerifyResult } from '../../shared/api/types';
import { Card, CardTitle, Chip, ErrorState, humanize, Loading, PageHeader } from '../ui';
import { IconShield } from '../../shared/ui/Icons';

const ACTOR_TYPES = ['', 'USER', 'AI', 'AGENT', 'SYSTEM', 'API_KEY'];

/**
 * Auditor event stream — docs/11 §6.3, AC-18.x.
 * Strictly read-only: this screen never issues a mutating request.
 *
 * The stream is a ledger with a sequence number, because the sequence number is
 * the thing the hash chain is built on. Reading down the column is reading the
 * chain.
 */
export default function EventsPage() {
  const [actorType, setActorType] = useState('');
  const [action, setAction] = useState('');
  const [caseId, setCaseId] = useState('');
  const [chain, setChain] = useState<ChainVerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams({ limit: '100' });
  if (actorType) params.set('actor_type', actorType);
  if (action) params.set('action', action);
  if (caseId) params.set('case_id', caseId);

  const query = useQuery({
    queryKey: ['auditor-events', actorType, action, caseId],
    queryFn: () => api.get<AuditEventList>(`/auditor/events?${params.toString()}`),
  });

  const verify = useMutation({
    mutationFn: () => api.get<ChainVerifyResult>('/auditor/verify-chain'),
    onSuccess: (res) => setChain(res),
    onError: (err) => setError(errorMessage(err, 'en')),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit events"
        subtitle="Append-only, SHA-256 hash-chained. Read-only console."
        actions={
          <button
            type="button"
            onClick={() => verify.mutate()}
            disabled={verify.isPending}
            className="press inline-flex min-h-[36px] items-center gap-1.5 rounded-control bg-accent px-3 text-caption font-medium text-white hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-45"
          >
            <IconShield size={14} />
            {verify.isPending ? 'Verifying…' : 'Verify hash chain'}
          </button>
        }
      />

      {chain && (
        <div
          role="status"
          className={`flex items-center gap-2 rounded-control border px-4 py-2.5 text-caption font-medium ${
            chain.valid
              ? 'border-positive/25 bg-positive-wash text-positive'
              : 'border-negative/25 bg-negative-wash text-negative'
          }`}
        >
          <span
            className={`live-dot ${chain.valid ? 'bg-positive' : 'bg-negative'}`}
            aria-hidden
          />
          {chain.valid
            ? `Chain intact: ${chain.checked_count.toLocaleString()} events verified.`
            : `Chain broken at seq ${chain.first_broken_seq}. ${chain.checked_count.toLocaleString()} events checked.`}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-control border border-negative/25 bg-negative-wash px-4 py-2.5 text-caption font-medium text-negative"
        >
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <select
          value={actorType}
          onChange={(e) => setActorType(e.target.value)}
          className="field w-auto"
          aria-label="Actor type"
        >
          {ACTOR_TYPES.map((t) => (
            <option key={t} value={t}>
              {t === '' ? 'All actors' : humanize(t)}
            </option>
          ))}
        </select>
        <input
          placeholder="Action (e.g. case.submitted)"
          aria-label="Action"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="field min-w-[220px] flex-1 font-mono"
        />
        <input
          placeholder="Case id"
          aria-label="Case id"
          value={caseId}
          onChange={(e) => setCaseId(e.target.value)}
          className="field min-w-[220px] flex-1 font-mono"
        />
      </div>

      {query.isLoading && <Loading />}
      {query.error && <ErrorState error={query.error} />}

      {query.data && (
        <Card className="overflow-x-auto p-0">
          <table className="ledger min-w-[940px]">
            <thead>
              <tr>
                <th className="text-end">Seq</th>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Hash</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((event) => (
                <tr key={event.id}>
                  <td className="num text-end font-mono text-meta text-ink-3">{event.seq}</td>
                  <td className="num text-meta text-ink-3">
                    {new Date(event.created_at).toLocaleString('en-GB', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td>
                    <Chip
                      tone={
                        event.actor_type === 'AI'
                          ? 'info'
                          : event.actor_type === 'AGENT'
                            ? 'warn'
                            : 'neutral'
                      }
                    >
                      {humanize(event.actor_type)}
                    </Chip>
                  </td>
                  <td className="font-mono text-meta font-medium text-ink">{event.action}</td>
                  <td className="text-meta text-ink-2">
                    {event.resource_type === 'case' && event.resource_id ? (
                      <Link
                        to={`/auditor/cases/${event.resource_id}`}
                        className="text-accent-ink hover:underline"
                      >
                        {event.resource_type}:{event.resource_id.slice(0, 8)}
                      </Link>
                    ) : (
                      `${event.resource_type}${event.resource_id ? `:${event.resource_id.slice(0, 8)}` : ''}`
                    )}
                  </td>
                  <td className="font-mono text-meta text-ink-3">
                    {event.event_hash.replace(/^sha256:/, '').slice(0, 12)}…
                  </td>
                </tr>
              ))}
              {query.data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-caption text-ink-3">
                    No events match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      <Card>
        <CardTitle hint="how it works">Tamper evidence</CardTitle>
        <p className="text-caption leading-[1.8] text-ink-2">
          Each event stores <code className="font-mono text-ink">prev_hash</code> and{' '}
          <code className="font-mono text-ink">
            event_hash = SHA256(prev_hash | seq | created_at | action | resource | payload)
          </code>
          . Editing any historical row breaks every hash after it, and Verify reports the exact
          first broken sequence number.
        </p>
      </Card>
    </div>
  );
}

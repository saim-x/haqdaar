import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { errorMessage } from '../../shared/api/errors';
import type { AuditEventList, ChainVerifyResult } from '../../shared/api/types';
import { Card, CardTitle, Chip, ErrorState, Loading, PageHeader } from '../ui';
import { IconShield } from '../../shared/ui/Icons';

const ACTOR_TYPES = ['', 'USER', 'AI', 'AGENT', 'SYSTEM', 'API_KEY'];

/**
 * Auditor event stream — docs/11 §6.3, AC-18.x.
 * Strictly read-only: this screen never issues a mutating request.
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
            className="inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-teal-700 px-3 text-xs font-bold text-white disabled:opacity-50"
          >
            <IconShield size={14} />
            {verify.isPending ? 'Verifying…' : 'Verify hash chain'}
          </button>
        }
      />

      {chain && (
        <div
          role="status"
          className={`rounded-lg border-2 px-3 py-2 text-xs font-bold ${
            chain.valid
              ? 'border-[#0F7B3F]/40 bg-[#0F7B3F]/5 text-[#0F7B3F]'
              : 'border-[#B42318]/40 bg-[#B42318]/5 text-[#B42318]'
          }`}
        >
          {chain.valid
            ? `Chain intact: ${chain.checked_count.toLocaleString()} events verified.`
            : `Chain broken at seq ${chain.first_broken_seq}. ${chain.checked_count.toLocaleString()} events checked.`}
        </div>
      )}
      {error && <div className="rounded-lg border-2 border-[#B42318]/30 bg-[#B42318]/5 px-3 py-2 text-xs font-semibold text-[#B42318]">{error}</div>}

      <div className="flex flex-wrap gap-2">
        <select
          value={actorType}
          onChange={(e) => setActorType(e.target.value)}
          className="min-h-tap rounded-lg border border-ink/15 bg-white px-2 text-xs font-semibold"
          aria-label="Actor type"
        >
          {ACTOR_TYPES.map((t) => (
            <option key={t} value={t}>
              {t === '' ? 'All actors' : t}
            </option>
          ))}
        </select>
        <input
          placeholder="Action (e.g. case.submitted)"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="min-h-tap min-w-[200px] rounded-lg border border-ink/15 px-2 text-xs"
        />
        <input
          placeholder="Case id"
          value={caseId}
          onChange={(e) => setCaseId(e.target.value)}
          className="min-h-tap min-w-[200px] rounded-lg border border-ink/15 px-2 text-xs"
        />
      </div>

      {query.isLoading && <Loading />}
      {query.error && <ErrorState error={query.error} />}

      {query.data && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-[11px] uppercase tracking-wide text-ink-soft">
                <th className="px-3 py-2">Seq</th>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Resource</th>
                <th className="px-3 py-2">Hash</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((event) => (
                <tr key={event.id} className="border-b border-ink/5 last:border-0 hover:bg-teal-50/40">
                  <td className="num px-3 py-1.5 text-[11px] text-ink-soft">{event.seq}</td>
                  <td className="num px-3 py-1.5 text-[11px] text-ink-soft">{new Date(event.created_at).toLocaleString()}</td>
                  <td className="px-3 py-1.5">
                    <Chip tone={event.actor_type === 'AI' ? 'info' : event.actor_type === 'AGENT' ? 'warn' : 'neutral'}>
                      {event.actor_type}
                    </Chip>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[11px] font-semibold text-ink">{event.action}</td>
                  <td className="px-3 py-1.5 text-[11px] text-ink-soft">
                    {event.resource_type === 'case' && event.resource_id ? (
                      <Link to={`/auditor/cases/${event.resource_id}`} className="text-teal-700 hover:underline">
                        {event.resource_type}:{event.resource_id.slice(0, 8)}
                      </Link>
                    ) : (
                      `${event.resource_type}${event.resource_id ? `:${event.resource_id.slice(0, 8)}` : ''}`
                    )}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[10px] text-ink-soft">{event.event_hash.slice(0, 12)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card>
        <CardTitle hint="how it works">Tamper evidence</CardTitle>
        <p className="text-xs leading-relaxed text-ink-soft">
          Each event stores <code className="font-mono">prev_hash</code> and{' '}
          <code className="font-mono">event_hash = SHA256(prev_hash | seq | created_at | action | resource | payload)</code>.
          Editing any historical row breaks every hash after it, and Verify reports the exact first broken sequence number.
        </p>
      </Card>
    </div>
  );
}

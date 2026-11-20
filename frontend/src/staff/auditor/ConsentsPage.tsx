import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import type { ConsentAccessLog, ConsentGrant } from '../../shared/api/types';
import { Card, CardTitle, Chip, ErrorState, Loading, PageHeader } from '../ui';

/** Consent audit — docs/11 §6.3.4. Grants, withdrawals, and allowed/denied access. */
export default function ConsentsPage() {
  const [citizenId, setCitizenId] = useState('');

  const query = useQuery({
    queryKey: ['auditor-consents', citizenId],
    queryFn: () =>
      api.get<{ grants: ConsentGrant[]; access_logs: ConsentAccessLog[] }>(
        `/auditor/consents${citizenId ? `?citizen_id=${encodeURIComponent(citizenId)}` : ''}`,
      ),
  });

  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorState error={query.error} />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Consent audit"
        subtitle="Every grant, withdrawal, and blocked access attempt — including the ones that returned 403."
        actions={
          <input
            placeholder="Filter by citizen id"
            value={citizenId}
            onChange={(e) => setCitizenId(e.target.value)}
            className="min-h-tap min-w-[240px] rounded-lg border border-ink/15 px-2 text-xs"
          />
        }
      />

      <Card className="overflow-x-auto">
        <CardTitle hint={`${query.data?.grants.length ?? 0} grants`}>Grants</CardTitle>
        <table className="w-full min-w-[720px] text-left text-[11px]">
          <thead>
            <tr className="border-b border-ink/10 text-[10px] uppercase text-ink-soft">
              <th className="py-1">Recipient</th>
              <th className="py-1">Type</th>
              <th className="py-1">Categories</th>
              <th className="py-1">Assurance</th>
              <th className="py-1">Status</th>
              <th className="py-1">Granted</th>
              <th className="py-1">Expires</th>
            </tr>
          </thead>
          <tbody>
            {query.data?.grants.map((grant) => (
              <tr key={grant.id} className="border-b border-ink/5">
                <td className="py-1 font-semibold text-ink">{grant.recipient_label}</td>
                <td className="py-1">{grant.recipient_type}</td>
                <td className="py-1">{grant.categories.join(', ')}</td>
                <td className="py-1">{grant.assurance_level}</td>
                <td className="py-1">
                  <Chip tone={grant.status === 'ACTIVE' ? 'ok' : grant.status === 'EXPIRED' ? 'warn' : 'danger'}>
                    {grant.status}
                  </Chip>
                </td>
                <td className="num py-1">{new Date(grant.granted_at).toLocaleDateString()}</td>
                <td className="num py-1">{grant.expires_at ? new Date(grant.expires_at).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="overflow-x-auto">
        <CardTitle hint={`${query.data?.access_logs.length ?? 0} entries`}>Access log</CardTitle>
        <table className="w-full min-w-[720px] text-left text-[11px]">
          <thead>
            <tr className="border-b border-ink/10 text-[10px] uppercase text-ink-soft">
              <th className="py-1">When</th>
              <th className="py-1">Actor</th>
              <th className="py-1">Category</th>
              <th className="py-1">Resource</th>
              <th className="py-1">Result</th>
            </tr>
          </thead>
          <tbody>
            {query.data?.access_logs.map((log) => (
              <tr key={log.id} className="border-b border-ink/5">
                <td className="num py-1">{new Date(log.created_at).toLocaleString()}</td>
                <td className="py-1 font-semibold text-ink">{log.actor_label}</td>
                <td className="py-1">{log.category}</td>
                <td className="py-1 font-mono">{log.resource_ref}</td>
                <td className="py-1">
                  <Chip tone={log.allowed ? 'ok' : 'danger'}>
                    {log.allowed ? 'ALLOWED' : `BLOCKED${log.denial_reason ? ` · ${log.denial_reason}` : ''}`}
                  </Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

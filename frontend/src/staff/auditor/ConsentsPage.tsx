import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import type { ConsentAccessLog, ConsentGrant } from '../../shared/api/types';
import { grantRecipientLabel } from '../../shared/lib/consent';
import { dayMonth, stamp } from '../../shared/lib/dates';
import { Card, ErrorState, humanize, Loading, PageHeader } from '../ui';
import { staffText } from '../staffI18n';

/**
 * Consent audit - docs/11 §6.3.4. Grants, withdrawals, and allowed/denied access.
 *
 * The access log is the important half: a blocked attempt is a row that exists
 * precisely because the system refused something, so it is drawn with the same
 * weight as an allowed one - a dot and a word, never a red block that reads as
 * an error in the console itself.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ConsentsPage() {
  const [citizenId, setCitizenId] = useState('');
  const trimmedCitizenId = citizenId.trim();
  const validUuid = !trimmedCitizenId || UUID_RE.test(trimmedCitizenId);

  const query = useQuery({
    queryKey: ['auditor-consents', validUuid ? trimmedCitizenId : ''],
    queryFn: () =>
      api.get<{ grants: ConsentGrant[]; access_logs: ConsentAccessLog[]; events: unknown[] }>(
        `/auditor/consents${trimmedCitizenId && validUuid ? `?citizen_id=${encodeURIComponent(trimmedCitizenId)}` : ''}`,
      ),
  });

  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorState error={query.error} />;

  return (
    <div className="space-y-4">
      <PageHeader
        title={staffText("Consent audit")}
        subtitle={staffText("Every grant, withdrawal, and blocked access attempt - including the ones that returned 403.")}
        actions={
          <input
            placeholder={staffText("Filter by citizen id")}
            aria-label={staffText("Filter by citizen id")}
            value={citizenId}
            onChange={(e) => setCitizenId(e.target.value)}
            className="field min-w-[260px] font-mono"
          />
        }
      />

      <Card className="overflow-x-auto p-0">
        <div className="flex items-baseline justify-between gap-3 border-b border-ink/[0.08] px-4 py-3">
          <h2 className="text-body font-medium text-ink">{staffText("Grants")}</h2>
          <p className="num text-meta text-ink-3">
            {query.data?.grants.length ?? 0}{' '}
            {(query.data?.grants.length ?? 0) === 1 ? 'grant' : 'grants'}
          </p>
        </div>
        <table className="ledger min-w-[820px]">
          <thead>
            <tr>
              <th>{staffText("Recipient")}</th>
              <th>{staffText("Kind")}</th>
              <th>{staffText("Categories")}</th>
              <th>{staffText("Assurance")}</th>
              <th>{staffText("Status")}</th>
              <th>{staffText("Granted")}</th>
              <th>{staffText("Expires")}</th>
            </tr>
          </thead>
          <tbody>
            {query.data?.grants.map((grant) => (
              <tr key={grant.id}>
                <td className="font-medium text-ink">{grantRecipientLabel(grant, 'en')}</td>
                <td className="text-meta text-ink-2">{humanize(grant.recipient_type)}</td>
                <td className="text-meta text-ink-2">
                  {grant.categories.map(humanize).join(', ')}
                </td>
                <td className="text-meta text-ink-2">{humanize(grant.assurance_level)}</td>
                <td>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={`live-dot ${
                        grant.status === 'ACTIVE'
                          ? 'bg-positive'
                          : grant.status === 'EXPIRED'
                            ? 'bg-warn'
                            : 'bg-negative'
                      }`}
                      aria-hidden
                    />
                    <span className="text-meta text-ink-2">{humanize(grant.status)}</span>
                  </span>
                </td>
                <td className="num whitespace-nowrap text-meta text-ink-3">
                  {dayMonth(grant.granted_at, 'en')}
                </td>
                <td className="num whitespace-nowrap text-meta text-ink-3">
                  {grant.expires_at ? dayMonth(grant.expires_at, 'en') : '-'}
                </td>
              </tr>
            ))}
            {query.data?.grants.length === 0 && (
              <tr>
                <td colSpan={7} className="text-caption text-ink-3">
                  {staffText("\r\n                  No grants recorded.\r\n                ")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Card className="overflow-x-auto p-0">
        <div className="flex items-baseline justify-between gap-3 border-b border-ink/[0.08] px-4 py-3">
          <h2 className="text-body font-medium text-ink">{staffText("Access log")}</h2>
          <p className="num text-meta text-ink-3">
            {query.data?.access_logs.length ?? 0}{' '}
            {(query.data?.access_logs.length ?? 0) === 1 ? 'attempt' : 'attempts'}
          </p>
        </div>
        <table className="ledger min-w-[820px]">
          <thead>
            <tr>
              <th>{staffText("When")}</th>
              <th>{staffText("Actor")}</th>
              <th>{staffText("Category")}</th>
              <th>{staffText("Resource")}</th>
              <th>{staffText("Result")}</th>
            </tr>
          </thead>
          <tbody>
            {query.data?.access_logs.map((log) => (
              <tr key={log.id}>
                <td className="num whitespace-nowrap text-meta text-ink-3">
                  {stamp(log.created_at, 'en')}
                </td>
                <td className="font-medium text-ink">{log.actor_label}</td>
                <td className="text-meta text-ink-2">{humanize(log.category)}</td>
                <td className="font-mono text-meta text-ink-2">{log.resource_ref}</td>
                <td>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={`live-dot ${log.allowed ? 'bg-positive' : 'bg-negative'}`}
                      aria-hidden
                    />
                    <span className="text-meta text-ink-2">
                      {log.allowed ? staffText('Allowed') : staffText('Blocked')}
                    </span>
                    {!log.allowed && log.denial_reason && (
                      <span className="text-meta text-ink-3">
                        {staffText("\r\n                        · ")}{humanize(log.denial_reason)}
                      </span>
                    )}
                  </span>
                </td>
              </tr>
            ))}
            {query.data?.access_logs.length === 0 && (
              <tr>
                <td colSpan={5} className="text-caption text-ink-3">
                  {staffText("\r\n                  No access attempts recorded.\r\n                ")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

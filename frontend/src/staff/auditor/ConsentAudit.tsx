import { useQuery } from '@tanstack/react-query';
import { Ban, CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { auditor } from '../../shared/api/endpoints';
import { cx } from '../../shared/ui/cx';
import { PageLoader } from '../../shared/ui/Spinner';
import { ErrorState, fmtTime, PageHeader, Panel, Stat } from '../ui';

/** Consent grant history + every allowed and denied access (Challenge 06). */
export function ConsentAudit() {
  const q = useQuery({ queryKey: ['auditor-consents'], queryFn: auditor.consents, refetchInterval: 6000 });
  const [deniedOnly, setDeniedOnly] = useState(false);
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} />;
  const { grants, access_logs } = q.data!;
  const denied = access_logs.filter((l) => !l.allowed);
  const logs = deniedOnly ? denied : access_logs;

  return (
    <div>
      <PageHeader eyebrow="Auditor · read-only" title="Consent records" subtitle="Withdrawal must truly stop access. Denied attempts are written in an isolated transaction before the 403 is returned, so they can never be rolled back." />
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Active grants" value={grants.filter((g) => g.status === 'ACTIVE').length} />
        <Stat label="Withdrawn" value={grants.filter((g) => g.status === 'WITHDRAWN').length} tone="warn" />
        <Stat label="Access checks logged" value={access_logs.length} />
        <Stat label="Blocked attempts" value={denied.length} tone="danger" />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          title="Access log"
          actions={
            <label className="flex items-center gap-2 text-xs font-semibold">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={deniedOnly} onChange={(e) => setDeniedOnly(e.target.checked)} />
              Blocked only
            </label>
          }
        >
          <ul className="max-h-[560px] divide-y divide-border overflow-y-auto">
            {logs.map((l) => (
              <li key={l.id} className={cx('flex items-start gap-2 py-2 text-sm', !l.allowed && 'bg-danger-soft/50')}>
                {l.allowed ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-label="allowed" /> : <Ban className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-label="blocked" />}
                <div className="min-w-0 flex-1">
                  <p>
                    <strong>{l.actor_label}</strong> <span className="text-muted-foreground">({l.actor_role})</span> → {l.category} · <span className="font-mono text-xs">{l.resource_ref}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmtTime(l.created_at)} {l.denial_reason && <span className="font-mono font-semibold text-danger">· {l.denial_reason}</span>}
                  </p>
                </div>
              </li>
            ))}
            {logs.length === 0 && <li className="py-6 text-center text-muted-foreground">No entries</li>}
          </ul>
        </Panel>
        <Panel title="Grants">
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Consent grants</caption>
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-1.5 pe-2">Recipient</th>
                  <th className="py-1.5 pe-2">Status</th>
                  <th className="py-1.5 pe-2">Assurance</th>
                  <th className="py-1.5">Granted / withdrawn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {grants.map((g) => (
                  <tr key={g.id}>
                    <td className="py-1.5 pe-2">
                      {g.recipient_label}
                      <span className="block font-mono text-[11px] text-muted-foreground">citizen {g.citizen_id.slice(0, 12)}</span>
                    </td>
                    <td className="py-1.5 pe-2">
                      <span className={cx('rounded px-1.5 py-0.5 text-[11px] font-bold', g.status === 'ACTIVE' ? 'bg-ok-soft text-ok' : g.status === 'WITHDRAWN' ? 'bg-danger-soft text-danger' : 'bg-muted text-muted-foreground')}>{g.status}</span>
                    </td>
                    <td className="py-1.5 pe-2 font-mono text-[11px]">{g.assurance_level}</td>
                    <td className="py-1.5 text-xs text-muted-foreground">
                      {fmtTime(g.granted_at)}
                      {g.withdrawn_at && <span className="block text-danger">withdrawn {fmtTime(g.withdrawn_at)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}

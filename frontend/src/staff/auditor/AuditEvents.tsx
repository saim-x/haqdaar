import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { auditor } from '../../shared/api/endpoints';
import type { AuditEvent } from '../../shared/api/types';
import { Button } from '../../shared/ui/Button';
import { cx } from '../../shared/ui/cx';
import { PageLoader } from '../../shared/ui/Spinner';
import { EmptyState, ErrorState, fmtTime, Hash, inputCls, PageHeader } from '../ui';
import { ChainBanner } from './ChainBanner';

const ACTOR_TONE: Record<AuditEvent['actor_type'], string> = {
  USER: 'bg-info-soft text-info',
  AI: 'bg-consent-soft text-consent',
  AGENT: 'bg-warn-soft text-warn',
  SYSTEM: 'bg-sunken text-muted',
  API_KEY: 'bg-ok-soft text-ok',
};

/** Filterable event stream of every user, AI and agent action (CORE-5, Challenge 05). */
export function AuditEvents() {
  const [caseId, setCaseId] = useState('');
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [applied, setApplied] = useState({ caseId: '', actor: '', action: '' });
  const [limit, setLimit] = useState(50);
  const [open, setOpen] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ['audit', applied, limit],
    queryFn: async () => {
      const r = await auditor.events({ case_id: applied.caseId || undefined, actor_type: applied.actor || undefined, action: applied.action || undefined, limit });
      return Array.isArray(r) ? { items: r, total: r.length } : r;
    },
    refetchInterval: 6000,
  });

  return (
    <div>
      <PageHeader eyebrow="Auditor · read-only" title="Audit log" subtitle="Every state change, AI call and agent step. Personal identifiers are redacted in payloads." />
      <ChainBanner />
      <form
        className="mb-4 grid gap-2 md:grid-cols-[1fr_180px_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ caseId: caseId.trim(), actor, action: action.trim() });
        }}
      >
        <input className={inputCls} placeholder="Case id" value={caseId} onChange={(e) => setCaseId(e.target.value)} aria-label="Filter by case id" />
        <select className={inputCls} value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Actor type">
          <option value="">All actors</option>
          {['USER', 'AI', 'AGENT', 'SYSTEM', 'API_KEY'].map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <input className={inputCls} placeholder="Action contains… (e.g. consent)" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action contains" />
        <Button type="submit" size="sm" icon={<Search className="h-4 w-4" aria-hidden />}>
          Filter
        </Button>
      </form>

      {q.isLoading ? (
        <PageLoader />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : !q.data?.items.length ? (
        <EmptyState title="No events match" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <caption className="sr-only">Audit events, newest first</caption>
            <thead className="bg-sunken text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="w-8 px-2 py-2" />
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Resource</th>
                <th className="px-3 py-2">Event hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {q.data.items.map((e) => (
                <FragmentRow key={e.id} e={e} open={open === e.seq} toggle={() => setOpen(open === e.seq ? null : e.seq)} />
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs text-muted">
            <span>
              Showing {q.data.items.length} of {q.data.total}
            </span>
            {q.data.items.length < q.data.total && (
              <Button size="sm" variant="ghost" onClick={() => setLimit((l) => Math.min(100, l + 50))}>
                Load more
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FragmentRow({ e, open, toggle }: { e: AuditEvent; open: boolean; toggle: () => void }) {
  const isCase = e.resource_type === 'case' && e.resource_id;
  return (
    <>
      <tr className={cx('hover:bg-sunken/60', e.action.includes('denied') || e.action.includes('forbidden') || e.action.includes('blocked') ? 'bg-danger-soft/50' : '')}>
        <td className="px-2 py-2">
          <button type="button" onClick={toggle} aria-expanded={open} aria-label={`Payload for event ${e.seq}`} className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-sunken">
            {open ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
          </button>
        </td>
        <td className="px-3 py-2 font-mono text-xs">{e.seq}</td>
        <td className="px-3 py-2 text-xs text-muted">{fmtTime(e.created_at)}</td>
        <td className="px-3 py-2">
          <span className={cx('rounded px-1.5 py-0.5 text-[11px] font-bold', ACTOR_TONE[e.actor_type])}>{e.actor_type}</span>
          <span className="ms-1 text-xs text-muted">{e.actor_role ?? e.actor_id}</span>
        </td>
        <td className="px-3 py-2 font-mono text-xs font-semibold">{e.action}</td>
        <td className="px-3 py-2 text-xs">
          {e.resource_type}
          {isCase ? (
            <Link to={`/auditor/cases/${e.resource_id}`} className="ms-1 font-mono text-brand hover:underline">
              {e.resource_id!.slice(0, 14)}
            </Link>
          ) : (
            e.resource_id && <span className="ms-1 font-mono text-muted">{e.resource_id.slice(0, 14)}</span>
          )}
        </td>
        <td className="px-3 py-2">
          <Hash value={e.event_hash} />
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="bg-sunken px-4 py-3">
            <pre className="overflow-x-auto font-mono text-xs">{JSON.stringify(e.payload_json, null, 2)}</pre>
            <p className="mt-2 font-mono text-[11px] text-muted">
              prev_hash {e.prev_hash.slice(0, 16)}… → event_hash {e.event_hash.slice(0, 16)}…
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

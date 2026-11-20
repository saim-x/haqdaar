import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CircleCheck,
  CircleHelp,
  CircleX,
  FileImage,
  HelpCircle,
  Lock,
  MessageSquarePlus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  UserCheck,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../../shared/api/client';
import { cases, officer } from '../../shared/api/endpoints';
import type { CaseDetail, DecideAction, FactValue, RuleTraceItem } from '../../shared/api/types';
import { authStore, useAuth } from '../../shared/auth/store';
import { Button } from '../../shared/ui/Button';
import { cx } from '../../shared/ui/cx';
import { Modal } from '../../shared/ui/Modal';
import { PageLoader } from '../../shared/ui/Spinner';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { ConfidenceBar, ErrorState, FlagChip, fmtTime, Hash, inputCls, Panel, pkr, PriorityBadge, ReasonChip } from '../ui';

const REASONS: Record<DecideAction, string[]> = {
  APPROVE: ['IDENTITY_CONFIRMED_BY_PHONE', 'DOCUMENT_CHECKED_IN_PERSON', 'INCOME_EXPLAINED', 'PAYOUT_OWNER_CONFIRMED', 'CONSENT_CONFIRMED_WITH_CITIZEN'],
  REJECT: ['NOT_ELIGIBLE_INCOME', 'NOT_ELIGIBLE_DISTRICT', 'IDENTITY_NOT_CONFIRMED', 'DUPLICATE_CONFIRMED', 'FORGED_DOCUMENT_CONFIRMED', 'SPOUSE_NOT_DECEASED'],
  REQUEST_INFO: ['NEED_CLEAR_CNIC_PHOTO', 'NEED_DEATH_CERTIFICATE', 'NEED_INCOME_DETAILS', 'NEED_NEW_PAYOUT_NUMBER'],
  ESCALATE: ['NEEDS_SENIOR_REVIEW', 'POSSIBLE_ORGANISED_FRAUD', 'POLICY_UNCLEAR'],
};

const SOURCE_TONE: Record<string, string> = {
  IDENTITY_REGISTRY: 'bg-info-soft text-info',
  CIVIL_REGISTRY: 'bg-info-soft text-info',
  HOUSEHOLD_SURVEY: 'bg-info-soft text-info',
  BENEFITS_REGISTRY: 'bg-info-soft text-info',
  DOCUMENT_QR: 'bg-ok-soft text-ok',
  DOCUMENT_VERIFIER: 'bg-ok-soft text-ok',
  SELF_DECLARED: 'bg-sunken text-muted',
  CONSENT_ENGINE: 'bg-consent-soft text-consent',
};

function fmtVal(v: unknown) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string' && /^\d{13}$/.test(v)) return `${v.slice(0, 5)}-****${v.slice(9, 12)}-${v.slice(12)}`;
  if (typeof v === 'number' && v > 999) return new Intl.NumberFormat('en-PK').format(v);
  return String(v);
}

export function FactsTable({ facts }: { facts: Record<string, FactValue> }) {
  const rows = Object.entries(facts);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <caption className="sr-only">Canonical facts with sources</caption>
        <thead className="text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="py-1.5 pe-3 font-semibold">Fact</th>
            <th className="py-1.5 pe-3 font-semibold">Value</th>
            <th className="py-1.5 pe-3 font-semibold">Source</th>
            <th className="py-1.5 font-semibold">Other values</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map(([k, f]) => (
            <tr key={k} className={cx(f.conflict && 'bg-warn-soft')}>
              <td className="py-2 pe-3 font-mono text-xs">{k}</td>
              <td className="py-2 pe-3 font-semibold">
                {f.state === 'UNKNOWN' ? (
                  <span className="inline-flex items-center gap-1 text-muted">
                    <CircleHelp className="h-3.5 w-3.5" aria-hidden />
                    UNKNOWN{f.missing_reason ? ` (${f.missing_reason})` : ''}
                  </span>
                ) : (
                  fmtVal(f.value)
                )}
                {f.conflict && (
                  <span className="ms-2 inline-flex items-center gap-1 text-xs font-bold text-warn">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                    conflict
                  </span>
                )}
              </td>
              <td className="py-2 pe-3">
                {f.source ? <span className={cx('rounded px-1.5 py-0.5 text-[11px] font-semibold', SOURCE_TONE[f.source] ?? 'bg-sunken')}>{f.source}</span> : <span className="text-muted">—</span>}
                {f.entered_by === 'HELPER' && <span className="ms-1 rounded bg-warn-soft px-1.5 py-0.5 text-[11px] font-semibold text-warn">by helper</span>}
              </td>
              <td className="py-2 text-xs text-muted">
                {f.alternatives.map((a, i) => (
                  <span key={i} className="me-2 inline-block">
                    {fmtVal(a.value)} <span className="font-mono">({a.source})</span>
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RuleTrace({ trace }: { trace: RuleTraceItem[] }) {
  const icon = { PASS: CircleCheck, FAIL: CircleX, UNKNOWN: HelpCircle };
  const tone = { PASS: 'text-ok', FAIL: 'text-danger', UNKNOWN: 'text-warn' };
  return (
    <ul className="divide-y divide-line">
      {trace.map((r) => {
        const I = icon[r.result];
        return (
          <li key={r.rule_id} className="flex items-start gap-3 py-2">
            <I className={cx('mt-0.5 h-5 w-5 shrink-0', tone[r.result])} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span className="font-mono text-xs font-semibold">{r.rule_id}</span>{' '}
                <span className={cx('text-xs font-bold', tone[r.result])}>{r.result}</span> <span className="text-muted">· {r.label_en}</span>
              </p>
              <p className="text-xs text-muted">
                actual <span className="font-mono">{fmtVal(r.actual)}</span> · rule <span className="font-mono">{String(r.expected)}</span>
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Fetches the image with the bearer token (no unauthenticated URLs for PII documents). */
function DocImage({ docId }: { docId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    fetch(`/api/v1/documents/${docId}/file`, { headers: { Authorization: `Bearer ${authStore.get().accessToken ?? ''}` } })
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => null)) as { error?: { code?: string } } | null;
          throw new Error(body?.error?.code ?? `HTTP ${r.status}`);
        }
        return r.blob();
      })
      .then((b) => {
        objectUrl = URL.createObjectURL(b);
        setUrl(objectUrl);
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [docId]);
  if (error) return <p className="rounded-lg bg-danger-soft p-3 text-sm font-semibold text-danger">Image not available: {error}</p>;
  if (!url) return <PageLoader />;
  return <img src={url} alt="Uploaded document (mock specimen)" className="mx-auto max-h-[60vh] rounded-lg border border-line" />;
}

function ConsentBlocked({ reference }: { reference?: string }) {
  return (
    <div role="alert" className="mx-auto max-w-xl rounded-card border-2 border-consent/40 bg-consent-soft p-8 text-center">
      <Lock className="mx-auto mb-3 h-12 w-12 text-consent" aria-hidden />
      <h1 className="text-2xl font-bold">Citizen withdrew consent — access blocked and logged.</h1>
      <p className="mt-2 text-muted">
        All personal data on {reference ?? 'this case'} is hidden. The case is paused (ON_HOLD_CONSENT) and this attempt now appears in the citizen&apos;s own access log.
      </p>
      <Link to="/staff/queue" className="mt-5 inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-line-strong px-4 font-semibold">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to queue
      </Link>
    </div>
  );
}

/** Two-column case review (docs/11 §6.1): evidence on the left, decision on the right. */
export function CaseReview() {
  const { id } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['staff-case', id], queryFn: () => cases.get(id!), refetchInterval: 8000, retry: false });
  const [action, setAction] = useState<DecideAction | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteVisible, setNoteVisible] = useState(false);
  const [docOpen, setDocOpen] = useState<string | null>(null);

  const refresh = (data?: CaseDetail) => {
    if (data) qc.setQueryData(['staff-case', id], data);
    void qc.invalidateQueries({ queryKey: ['queue'] });
  };
  const assign = useMutation({ mutationFn: () => officer.assign(id!), onSuccess: refresh });
  const decide = useMutation({
    mutationFn: () => officer.decide(id!, { action: action!, reason_codes: reasons, note: note.trim() }),
    onSuccess: (d) => {
      refresh(d);
      setAction(null);
      setReasons([]);
      setNote('');
    },
  });
  const reeval = useMutation({ mutationFn: () => officer.reevaluate(id!), onSuccess: refresh });
  const addNote = useMutation({
    mutationFn: () => officer.note(id!, noteText.trim(), noteVisible),
    onSuccess: () => {
      setNoteOpen(false);
      setNoteText('');
      void q.refetch();
    },
  });

  if (q.isLoading) return <PageLoader />;
  const err = q.error as ApiError | null;
  if (err?.code === 'CONSENT_REVOKED') return <ConsentBlocked />;
  if (err) return <ErrorState error={err} />;
  const c = q.data!;
  const threshold = 0.9;
  const high = (c.flags ?? []).some((f) => f.severity === 'HIGH');
  const stale = c.rule_version && c.active_rule_version && c.rule_version.id !== c.active_rule_version.id;
  const iAmFirstApprover = c.first_approver?.id === user?.id;
  const decidable = ['HUMAN_REVIEW', 'IN_REVIEW', 'PENDING_SECOND_APPROVAL'].includes(c.status);
  const needsReason = action === 'REJECT' || (action === 'APPROVE' && (c.flags?.length ?? 0) > 0);
  const decideErr = decide.error as ApiError | null;
  const conf = c.confidence_components;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link to="/staff/queue" className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 text-sm font-semibold text-muted hover:bg-sunken hover:text-ink">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Queue
        </Link>
        <h1 className="font-mono text-2xl font-bold">{c.reference_code}</h1>
        <StatusBadge status={c.status} variant="staff" />
        {c.priority_band && <PriorityBadge band={c.priority_band} score={c.priority_score} />}
        <span className="text-muted">
          {c.citizen?.full_name} · <span className="font-mono text-sm">{c.citizen?.cnic_masked}</span> · {c.citizen?.district}
        </span>
        {c.submitted_via_helper && <span className="rounded bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn">Submitted by helper</span>}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* LEFT: evidence */}
        <div className="min-w-0 space-y-5">
          {c.ai_case_note && (
            <section className="card overflow-hidden border-s-4 border-s-info">
              <div className="flex items-center gap-2 border-b border-line bg-info-soft px-4 py-3">
                <Sparkles className="h-4 w-4 text-info" aria-hidden />
                <h2 className="text-sm font-bold uppercase tracking-wide text-info">AI case handoff · system said &quot;I am not sure&quot;</h2>
              </div>
              <div className="grid gap-4 p-4 md:grid-cols-3">
                <div>
                  <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-ok">
                    <CircleCheck className="h-4 w-4" aria-hidden />
                    Verified
                  </h3>
                  <ul className="space-y-1 text-sm">
                    {c.ai_case_note.verified.map((v) => (
                      <li key={v}>{v}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-warn">
                    <HelpCircle className="h-4 w-4" aria-hidden />
                    Uncertain
                  </h3>
                  <ul className="space-y-1 text-sm">
                    {c.ai_case_note.uncertain.map((v) => (
                      <li key={v}>{v}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-info">
                    <UserCheck className="h-4 w-4" aria-hidden />
                    Suggested checks
                  </h3>
                  <ol className="list-inside list-decimal space-y-1 text-sm">
                    {c.ai_case_note.suggested_checks.map((v) => (
                      <li key={v}>{v}</li>
                    ))}
                  </ol>
                </div>
              </div>
            </section>
          )}

          {(c.flags?.length ?? 0) > 0 && (
            <Panel title="Risk flags">
              <ul className="space-y-2">
                {c.flags!.map((f) => (
                  <li key={f.code} className="flex flex-wrap items-start gap-2">
                    <FlagChip flag={f} />
                    <span className="text-sm text-muted">{f.detail}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {conf && (
            <Panel title="Weakest-link confidence (4 pillars)">
              <div className="grid gap-3 sm:grid-cols-2">
                <ConfidenceBar value={conf.identity} threshold={threshold} label="Identity" />
                <ConfidenceBar value={conf.documents} threshold={threshold} label="Documents" />
                <ConfidenceBar value={conf.data_consistency} threshold={threshold} label="Data consistency" />
                <ConfidenceBar value={conf.consent_assurance} threshold={threshold} label="Consent assurance" />
              </div>
              <div className="mt-4 flex items-center justify-between rounded-lg bg-sunken px-3 py-2 text-sm">
                <span>
                  Overall = <span className="font-mono">min(pillars)</span>
                </span>
                <span className={cx('font-mono text-lg font-bold', conf.overall >= threshold ? 'text-ok' : 'text-danger')}>{conf.overall.toFixed(3)}</span>
              </div>
            </Panel>
          )}

          {c.facts && Object.keys(c.facts).length > 0 && (
            <Panel title="Canonical facts & provenance">
              <FactsTable facts={c.facts} />
            </Panel>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            {c.rule_trace && c.rule_trace.length > 0 && (
              <Panel title={`Rule trace${c.rule_version ? ` · v${c.rule_version.version_number}` : ''}`} actions={c.rule_version && <Hash value={c.rule_version.content_hash} />}>
                <RuleTrace trace={c.rule_trace} />
              </Panel>
            )}
            <Panel title="Agent steps">
              {c.agent_steps && c.agent_steps.length ? (
                <ol className="space-y-2">
                  {c.agent_steps.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', s.status === 'FAILED' ? 'bg-danger' : s.status === 'RETRIED' ? 'bg-warn' : 'bg-ok')} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p>
                          <span className="font-mono text-xs font-semibold">{s.tool}</span> <span className="text-xs text-muted">{s.duration_ms} ms · {s.status}</span>
                        </p>
                        <p className="text-xs text-muted">{s.summary}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted">No agent steps recorded.</p>
              )}
            </Panel>
          </div>

          <Panel title="Documents & computer-vision checks">
            {c.documents.length ? (
              <ul className="grid gap-3 md:grid-cols-2">
                {c.documents.map((d) => (
                  <li key={d.id} className="rounded-lg border border-line p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold">{d.doc_type}</p>
                      <span
                        className={cx(
                          'rounded px-1.5 py-0.5 text-xs font-bold',
                          d.verify_status === 'VERIFIED' ? 'bg-ok-soft text-ok' : d.verify_status === 'TAMPER_SUSPECTED' ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn',
                        )}
                      >
                        {d.verify_status}
                      </span>
                    </div>
                    <ul className="mt-2 space-y-1 text-xs">
                      {(d.verify_checks ?? []).map((ck) => (
                        <li key={ck.check} className="flex items-center gap-1.5">
                          {ck.passed ? <Check className="h-3.5 w-3.5 text-ok" aria-label="passed" /> : <CircleX className="h-3.5 w-3.5 text-danger" aria-label="failed" />}
                          <span className="font-mono">{ck.check}</span>
                          <span className="text-muted">
                            {ck.value !== null && ck.value !== undefined ? String(ck.value) : '—'} / {String(ck.threshold ?? '')}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <Button size="sm" variant="ghost" className="mt-2" icon={<FileImage className="h-4 w-4" aria-hidden />} onClick={() => setDocOpen(d.id)}>
                      View image (consent-gated)
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No documents uploaded — CNIC check falls back to registry; officer may request a photo.</p>
            )}
          </Panel>

          <Panel title="Timeline & notes">
            <ol className="space-y-2 text-sm">
              {c.timeline.map((t, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-36 shrink-0 font-mono text-xs text-muted">{fmtTime(t.at)}</span>
                  <span>{t.label_en}</span>
                </li>
              ))}
              {(c.notes ?? []).map((n) => (
                <li key={n.id} className="flex gap-3">
                  <span className="w-36 shrink-0 font-mono text-xs text-muted">{fmtTime(n.created_at)}</span>
                  <span>
                    <span className="font-semibold">{n.author_label ?? 'System'}:</span> {n.body}
                    {n.is_visible_to_citizen && <span className="ms-1 text-xs text-info">(visible to citizen)</span>}
                  </span>
                </li>
              ))}
            </ol>
          </Panel>

          {c.citizen_explanation && (
            <Panel title="What the citizen sees (Urdu + English)">
              <p className="font-urdu text-lg" lang="ur" dir="rtl">
                {c.citizen_explanation.headline_ur}
              </p>
              <p className="mt-1 text-muted">{c.citizen_explanation.headline_en}</p>
              <p className="mt-2 text-xs text-muted">Never accusatory: internal flags such as TAMPER_SUSPECTED are not shown to the citizen.</p>
            </Panel>
          )}
        </div>

        {/* RIGHT: decision panel */}
        <aside className="space-y-4 xl:sticky xl:top-[44px] xl:self-start">
          {stale && (
            <div className="rounded-card border-2 border-warn/50 bg-warn-soft p-4">
              <p className="flex items-center gap-2 font-bold text-warn">
                <AlertTriangle className="h-5 w-5" aria-hidden />
                Evaluated with v{c.rule_version!.version_number}; v{c.active_rule_version!.version_number} is active
              </p>
              <Button size="sm" className="mt-3" variant="secondary" loading={reeval.isPending} onClick={() => reeval.mutate()} icon={<RefreshCw className="h-4 w-4" aria-hidden />}>
                Re-evaluate with current rules
              </Button>
            </div>
          )}

          <section className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted">Decision</h2>
              <span className="text-sm">
                Amount <span className="font-mono font-bold">{pkr(c.approved_amount_pkr)}</span>
              </span>
            </div>

            {c.status === 'PENDING_SECOND_APPROVAL' && (
              <div className={cx('mb-3 rounded-lg p-3 text-sm', iAmFirstApprover ? 'bg-danger-soft text-danger' : 'bg-info-soft text-info')}>
                <p className="flex items-center gap-1.5 font-bold">
                  <Users className="h-4 w-4" aria-hidden />
                  Four-eyes: first approval by {c.first_approver?.full_name}
                </p>
                <p className="mt-1">{iAmFirstApprover ? 'You gave the first approval. A different officer must approve.' : 'Your approval completes this case and releases payment.'}</p>
              </div>
            )}
            {high && c.status !== 'PENDING_SECOND_APPROVAL' && decidable && (
              <p className="mb-3 flex items-start gap-1.5 rounded-lg bg-warn-soft p-3 text-sm text-warn">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                HIGH flag present: your approval sends this case to a second officer.
              </p>
            )}

            {c.status === 'HUMAN_REVIEW' && (
              <Button block className="mb-3" loading={assign.isPending} onClick={() => assign.mutate()} icon={<UserCheck className="h-4 w-4" aria-hidden />}>
                Assign to me
              </Button>
            )}
            {c.assigned_officer && <p className="mb-3 text-sm text-muted">Assigned to {c.assigned_officer.full_name}</p>}

            {decidable ? (
              <>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Action">
                  {(
                    [
                      ['APPROVE', 'Approve', 'border-ok text-ok'],
                      ['REQUEST_INFO', 'Request info', 'border-info text-info'],
                      ['REJECT', 'Reject', 'border-danger text-danger'],
                      ['ESCALATE', 'Escalate', 'border-line-strong text-ink'],
                    ] as const
                  ).map(([a, label, tone]) => (
                    <button
                      key={a}
                      type="button"
                      role="radio"
                      aria-checked={action === a}
                      onClick={() => {
                        setAction(a);
                        setReasons([]);
                        decide.reset();
                      }}
                      className={cx('min-h-[44px] rounded-lg border-2 px-2 text-sm font-bold transition-colors duration-fast', action === a ? `${tone} bg-sunken` : 'border-line text-muted hover:border-line-strong')}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {action && (
                  <div className="mt-4 space-y-3 animate-rise">
                    <fieldset>
                      <legend className="mb-1 text-sm font-semibold">
                        Reason codes {needsReason && <span className="text-danger">(required)</span>}
                      </legend>
                      <div className="space-y-1">
                        {REASONS[action].map((r) => (
                          <label key={r} className="flex min-h-[32px] items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-brand"
                              checked={reasons.includes(r)}
                              onChange={(e) => setReasons((x) => (e.target.checked ? [...x, r] : x.filter((y) => y !== r)))}
                            />
                            <span className="font-mono text-xs">{r}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <label className="block">
                      <span className="mb-1 block text-sm font-semibold">Note {needsReason && <span className="text-danger">(required)</span>}</span>
                      <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={cx(inputCls, 'py-2')} placeholder={action === 'REJECT' ? 'Shown to the citizen in plain words' : 'Internal note'} />
                    </label>
                    {decideErr && (
                      <p role="alert" className="rounded-lg bg-danger-soft p-2 text-sm font-semibold text-danger">
                        {decideErr.code === 'SAME_OFFICER' ? '403 SAME_OFFICER — a different officer must give the second approval.' : `${decideErr.code}: ${decideErr.message}`}
                      </p>
                    )}
                    <Button
                      block
                      variant={action === 'REJECT' ? 'danger' : action === 'APPROVE' ? 'success' : 'primary'}
                      loading={decide.isPending}
                      disabled={needsReason && (!reasons.length || !note.trim())}
                      onClick={() => decide.mutate()}
                    >
                      Confirm {action.replace('_', ' ').toLowerCase()}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <p className="rounded-lg bg-sunken p-3 text-sm text-muted">No officer decision needed in status {c.status}.</p>
            )}
          </section>

          <section className="card p-4">
            <Button block variant="secondary" size="sm" icon={<MessageSquarePlus className="h-4 w-4" aria-hidden />} onClick={() => setNoteOpen(true)}>
              Add note
            </Button>
            <dl className="mt-3 space-y-1.5 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Engine route</dt>
                <dd>{c.latest_route ? <ReasonChip code={c.latest_route} /> : '—'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Ask-more rounds</dt>
                <dd className="font-mono">{c.ask_more_rounds ?? 0} / 2</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Rule hash</dt>
                <dd>
                  <Hash value={c.rule_version?.content_hash} />
                </dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>

      <Modal
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        title="Add note"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNoteOpen(false)}>
              Cancel
            </Button>
            <Button loading={addNote.isPending} disabled={!noteText.trim()} onClick={() => addNote.mutate()}>
              Save note
            </Button>
          </>
        }
      >
        <textarea rows={4} value={noteText} onChange={(e) => setNoteText(e.target.value)} className={cx(inputCls, 'py-2')} aria-label="Note" />
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-brand" checked={noteVisible} onChange={(e) => setNoteVisible(e.target.checked)} />
          Visible to citizen
        </label>
      </Modal>

      <Modal open={!!docOpen} onClose={() => setDocOpen(null)} title="Document image" size="lg">
        {docOpen && (
          <div>
            <DocImage docId={docOpen} />
            <p className="mt-2 text-xs text-muted">Served only after a server-side consent check; the access is logged and visible to the citizen.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

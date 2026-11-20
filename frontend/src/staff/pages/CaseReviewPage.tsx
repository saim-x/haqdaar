import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { ApiError, errorMessage } from '../../shared/api/errors';
import type { CaseView, FactObject, RuleTraceEntry } from '../../shared/api/types';
import { Card, CardTitle, Chip, ConfidenceBar, ErrorState, Loading, PageHeader } from '../ui';
import { IconLock, IconWarning } from '../../shared/ui/Icons';

const REASON_CODES = [
  'DOCUMENT_ILLEGIBLE',
  'INCOME_CONFLICT',
  'IDENTITY_AMBIGUOUS',
  'DUPLICATE_SUSPECTED',
  'PAYOUT_MISMATCH',
  'CONSENT_LOW_ASSURANCE',
  'POLICY_DISCRETION',
  'OTHER',
];

const ACTIONS = [
  { key: 'APPROVE', label: 'Approve', tone: 'bg-[#0F7B3F] text-white' },
  { key: 'REQUEST_INFO', label: 'Request info', tone: 'bg-amber-400 text-[#3B2A00]' },
  { key: 'REJECT', label: 'Reject', tone: 'bg-[#B42318] text-white' },
  { key: 'ESCALATE', label: 'Escalate', tone: 'bg-slate-700 text-white' },
] as const;

type ActionKey = (typeof ACTIONS)[number]['key'];

function sourceTone(source: string | null): 'ok' | 'info' | 'warn' | 'neutral' {
  if (!source) return 'neutral';
  if (source.includes('REGISTRY')) return 'info';
  if (source.includes('DOCUMENT')) return 'ok';
  if (source.includes('SELF')) return 'warn';
  return 'neutral';
}

function FactRow({ factKey, fact }: { factKey: string; fact: FactObject }) {
  return (
    <tr className={`border-b border-ink/5 last:border-0 ${fact.conflict ? 'bg-amber-50' : ''}`}>
      <td className="px-2 py-1.5 font-mono text-[11px] text-ink-soft">{factKey}</td>
      <td className="px-2 py-1.5 text-xs font-semibold text-ink">
        {fact.state === 'UNKNOWN' ? <span className="text-ink-soft">UNKNOWN</span> : String(fact.value ?? '—')}
        {fact.missing_reason && <span className="ms-1 text-[10px] text-ink-soft">({fact.missing_reason})</span>}
      </td>
      <td className="px-2 py-1.5">
        <Chip tone={sourceTone(fact.source)}>{fact.source ?? '—'}</Chip>
      </td>
      <td className="px-2 py-1.5 text-[11px] text-ink-soft">{fact.entered_by}</td>
      <td className="px-2 py-1.5">
        {fact.conflict ? <Chip tone="danger">conflict</Chip> : <span className="text-[11px] text-ink-soft">—</span>}
      </td>
    </tr>
  );
}

function TraceRow({ entry }: { entry: RuleTraceEntry }) {
  const tone = entry.result === 'PASS' ? 'ok' : entry.result === 'FAIL' ? 'danger' : 'warn';
  return (
    <tr className="border-b border-ink/5 last:border-0">
      <td className="px-2 py-1.5 font-mono text-[11px] text-ink-soft">{entry.rule_id}</td>
      <td className="px-2 py-1.5">
        <Chip tone={tone}>{entry.result}</Chip>
      </td>
      <td className="px-2 py-1.5 text-[11px] text-ink">{entry.reason_en}</td>
    </tr>
  );
}

/**
 * Officer case review — docs/11 §6.1.
 * Two columns: evidence on the left, decision on the right. A withdrawn consent
 * replaces the whole screen with a lock view that contains zero PII.
 */
export default function CaseReviewPage({ caseId }: { caseId?: string } = {}) {
  const params = useParams();
  const id = caseId ?? params.id ?? '';
  const queryClient = useQueryClient();
  const [action, setAction] = useState<ActionKey>('APPROVE');
  const [reasonCodes, setReasonCodes] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [banner, setBanner] = useState<{ tone: 'ok' | 'danger' | 'warn'; text: string } | null>(null);

  const query = useQuery({
    queryKey: ['officer-case', id],
    queryFn: () => api.get<CaseView>(`/cases/${id}`),
    retry: (count, err) => !(err instanceof ApiError && err.isConsentRevoked) && count < 2,
  });

  const decide = useMutation({
    mutationFn: () =>
      api.post(`/officer/cases/${id}/decide`, {
        action,
        reason_codes: reasonCodes,
        note,
      }),
    onSuccess: () => {
      setBanner({ tone: 'ok', text: `Decision recorded: ${action}.` });
      void queryClient.invalidateQueries({ queryKey: ['officer-case', id] });
      void queryClient.invalidateQueries({ queryKey: ['officer-queue'] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'SAME_OFFICER') {
        setBanner({
          tone: 'danger',
          text: 'Four-eyes rule: you gave the first approval. A different officer must give the second.',
        });
        return;
      }
      setBanner({ tone: 'danger', text: errorMessage(err, 'en') });
    },
  });

  const assign = useMutation({
    mutationFn: () => api.post(`/officer/cases/${id}/assign`),
    onSuccess: () => {
      setBanner({ tone: 'ok', text: 'Assigned to you.' });
      void queryClient.invalidateQueries({ queryKey: ['officer-case', id] });
    },
    onError: (err) => setBanner({ tone: 'danger', text: errorMessage(err, 'en') }),
  });

  const reevaluate = useMutation({
    mutationFn: () => api.post(`/officer/cases/${id}/reevaluate`),
    onSuccess: () => {
      setBanner({ tone: 'ok', text: 'Re-evaluated with the current rule version.' });
      void queryClient.invalidateQueries({ queryKey: ['officer-case', id] });
    },
    onError: (err) => setBanner({ tone: 'danger', text: errorMessage(err, 'en') }),
  });

  const consentRevoked = query.error instanceof ApiError && query.error.isConsentRevoked;
  const caseData = query.data;

  const facts = useMemo(() => Object.entries(caseData?.facts ?? {}), [caseData]);
  const highFlags = (caseData?.flags ?? []).filter((f) => f.severity === 'HIGH');
  const ruleStale =
    caseData?.latest_rule_version && caseData?.active_rule_version
      ? caseData.latest_rule_version.version_number !== caseData.active_rule_version.version_number
      : false;

  if (query.isLoading) return <Loading label="Loading case…" />;

  if (consentRevoked) {
    return (
      <div className="mx-auto max-w-xl">
        <Card className="border-2 border-[#6D28D9]/40 bg-[#6D28D9]/5 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-[#6D28D9] text-white">
            <IconLock size={28} />
          </div>
          <h1 className="text-lg font-bold text-[#6D28D9]">Citizen withdrew consent</h1>
          <p className="mt-1 text-sm text-ink">
            Access is blocked and the attempt has been logged. This case is now <strong>ON_HOLD_CONSENT</strong>.
          </p>
          <p className="mt-3 text-xs text-ink-soft">
            No personal data is shown on this screen. The citizen can re-grant access at any time and the case resumes
            from where it stopped.
          </p>
          <Link to="/staff/queue" className="mt-4 inline-block rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white">
            Back to queue
          </Link>
        </Card>
      </div>
    );
  }

  if (query.error) return <ErrorState error={query.error} />;
  if (!caseData) return <ErrorState error={new Error('Case not found')} />;

  const needsReason = action === 'REJECT' || action === 'APPROVE';
  const canSubmit = !needsReason || (reasonCodes.length > 0 && note.trim().length > 0);

  return (
    <div>
      <PageHeader
        title={caseData.reference_code}
        subtitle={`${caseData.applicant?.full_name ?? 'Applicant'} · ${caseData.applicant?.cnic_masked ?? ''} · ${caseData.status}`}
        actions={
          <>
            <button
              type="button"
              onClick={() => assign.mutate()}
              disabled={assign.isPending}
              className="min-h-tap rounded-lg border border-ink/15 bg-white px-3 text-xs font-semibold text-ink hover:bg-ink/5"
            >
              Assign to me
            </button>
            <Link to="/staff/queue" className="min-h-tap rounded-lg px-3 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50">
              Back to queue
            </Link>
          </>
        }
      />

      {banner && (
        <div
          role="status"
          className={`mb-3 rounded-lg border-2 px-3 py-2 text-xs font-semibold ${
            banner.tone === 'ok'
              ? 'border-[#0F7B3F]/30 bg-[#0F7B3F]/5 text-[#0F7B3F]'
              : banner.tone === 'warn'
                ? 'border-amber-400/50 bg-amber-50 text-amber-700'
                : 'border-[#B42318]/30 bg-[#B42318]/5 text-[#B42318]'
          }`}
        >
          {banner.text}
        </div>
      )}

      {ruleStale && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border-2 border-amber-400/60 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
          <IconWarning size={14} />
          Evaluated with v{caseData.latest_rule_version?.version_number}; current is v
          {caseData.active_rule_version?.version_number}.
          <button
            type="button"
            onClick={() => reevaluate.mutate()}
            disabled={reevaluate.isPending}
            className="ms-auto rounded bg-amber-400 px-2 py-1 text-[11px] font-bold text-[#3B2A00]"
          >
            Re-evaluate
          </button>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Card>
            <CardTitle hint="AI proposes, policy disposes">AI case handoff</CardTitle>
            {caseData.ai_case_note ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="mb-1 text-[11px] font-bold uppercase text-[#0F7B3F]">Verified</p>
                  <ul className="space-y-1 text-xs text-ink">
                    {caseData.ai_case_note.verified.map((v) => (
                      <li key={v}>• {v}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-bold uppercase text-amber-700">Uncertain</p>
                  <ul className="space-y-1 text-xs text-ink">
                    {caseData.ai_case_note.uncertain.map((v) => (
                      <li key={v}>• {v}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-bold uppercase text-[#1D4ED8]">Suggested checks</p>
                  <ul className="space-y-1 text-xs text-ink">
                    {caseData.ai_case_note.suggested_checks.map((v) => (
                      <li key={v}>• {v}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="text-xs text-ink-soft">No handoff note recorded for this case.</p>
            )}
          </Card>

          <Card className="overflow-x-auto">
            <CardTitle hint={`${facts.length} facts`}>Canonical facts</CardTitle>
            <table className="w-full min-w-[560px] text-left">
              <thead>
                <tr className="border-b border-ink/10 text-[10px] uppercase tracking-wide text-ink-soft">
                  <th className="px-2 py-1">Fact</th>
                  <th className="px-2 py-1">Value</th>
                  <th className="px-2 py-1">Source</th>
                  <th className="px-2 py-1">Entered by</th>
                  <th className="px-2 py-1">Conflict</th>
                </tr>
              </thead>
              <tbody>
                {facts.map(([key, fact]) => (
                  <FactRow key={key} factKey={key} fact={fact} />
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="overflow-x-auto">
            <CardTitle hint="PASS / FAIL / UNKNOWN">Rule trace</CardTitle>
            <table className="w-full min-w-[520px] text-left">
              <thead>
                <tr className="border-b border-ink/10 text-[10px] uppercase tracking-wide text-ink-soft">
                  <th className="px-2 py-1">Rule</th>
                  <th className="px-2 py-1">Result</th>
                  <th className="px-2 py-1">Reason</th>
                </tr>
              </thead>
              <tbody>
                {(caseData.rule_trace ?? []).map((entry) => (
                  <TraceRow key={entry.rule_id} entry={entry} />
                ))}
              </tbody>
            </table>
          </Card>

          <Card>
            <CardTitle hint="Blur · QR HMAC · OCR vs QR">Documents</CardTitle>
            <ul className="space-y-2">
              {caseData.documents.map((doc) => (
                <li key={doc.id} className="rounded-lg border border-ink/10 p-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-ink">{doc.doc_type}</span>
                    <Chip
                      tone={
                        doc.verify_status === 'VERIFIED'
                          ? 'ok'
                          : doc.verify_status === 'TAMPER_SUSPECTED'
                            ? 'danger'
                            : 'warn'
                      }
                    >
                      {doc.verify_status}
                    </Chip>
                    <a
                      href={`/api/v1/documents/${doc.id}/file`}
                      target="_blank"
                      rel="noreferrer"
                      className="ms-auto text-[11px] font-semibold text-teal-700 hover:underline"
                    >
                      Open file
                    </a>
                  </div>
                  {doc.verify_checks && doc.verify_checks.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {doc.verify_checks.map((check) => (
                        <li key={check.check} className="flex items-center gap-1.5 text-[11px] text-ink-soft">
                          <Chip tone={check.passed ? 'ok' : 'danger'}>{check.passed ? 'pass' : 'fail'}</Chip>
                          <span className="font-mono">{check.check}</span>
                          {check.value !== undefined && <span className="num">{String(check.value)}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
              {caseData.documents.length === 0 && <li className="text-xs text-ink-soft">No documents attached.</li>}
            </ul>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardTitle hint={`${caseData.flags?.length ?? 0} active`}>Risk flags</CardTitle>
              <ul className="space-y-1">
                {(caseData.flags ?? []).map((flag) => (
                  <li key={flag.code} className="flex items-center gap-1.5 text-xs">
                    <Chip tone={flag.severity === 'HIGH' ? 'danger' : flag.severity === 'MEDIUM' ? 'warn' : 'neutral'}>
                      {flag.severity}
                    </Chip>
                    <span className="font-mono text-[11px] text-ink">{flag.code}</span>
                  </li>
                ))}
                {(caseData.flags?.length ?? 0) === 0 && <li className="text-xs text-ink-soft">No flags.</li>}
              </ul>
            </Card>

            <Card>
              <CardTitle hint="agent.step">Agent timeline</CardTitle>
              <ol className="space-y-1">
                {(caseData.agent_steps ?? []).map((step) => (
                  <li key={`${step.at}-${step.step}`} className="flex items-center gap-1.5 text-[11px]">
                    <Chip tone={step.status === 'OK' ? 'ok' : step.status === 'FAILED' ? 'danger' : 'neutral'}>
                      {step.status}
                    </Chip>
                    <span className="font-mono text-ink">{step.step}</span>
                    <span className="num ms-auto text-ink-soft">{step.duration_ms}ms</span>
                  </li>
                ))}
                {(caseData.agent_steps?.length ?? 0) === 0 && <li className="text-xs text-ink-soft">No agent steps yet.</li>}
              </ol>
            </Card>
          </div>
        </div>

        <aside className="space-y-3">
          <Card>
            <CardTitle>Decision</CardTitle>
            <div className="mb-3 flex items-center justify-between text-xs">
              <span className="text-ink-soft">Confidence</span>
              <ConfidenceBar value={caseData.latest_confidence ?? null} />
            </div>

            <div className="mb-3 grid grid-cols-2 gap-1.5">
              {ACTIONS.map(({ key, label, tone }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setAction(key)}
                  aria-pressed={action === key}
                  className={`min-h-tap rounded-lg text-xs font-bold ${
                    action === key ? tone : 'border border-ink/15 bg-white text-ink-soft'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <p className="mb-1 text-[11px] font-bold uppercase text-ink-soft">
              Reason codes {needsReason && <span className="text-[#B42318]">*</span>}
            </p>
            <div className="mb-3 flex flex-wrap gap-1">
              {REASON_CODES.map((code) => {
                const on = reasonCodes.includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() =>
                      setReasonCodes((prev) => (on ? prev.filter((c) => c !== code) : [...prev, code]))
                    }
                    className={`rounded px-1.5 py-1 text-[10px] font-semibold ${
                      on ? 'bg-teal-600 text-white' : 'bg-ink/5 text-ink-soft'
                    }`}
                  >
                    {code}
                  </button>
                );
              })}
            </div>

            <label htmlFor="note" className="mb-1 block text-[11px] font-bold uppercase text-ink-soft">
              Note {needsReason && <span className="text-[#B42318]">*</span>}
            </label>
            <textarea
              id="note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mb-3 w-full rounded-lg border border-ink/15 p-2 text-xs"
              placeholder="Explain the decision. The citizen sees a plain-language version."
            />

            {highFlags.length > 0 && (
              <p className="mb-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] font-semibold text-amber-700">
                HIGH flag present: your approval sends this case to a second officer.
              </p>
            )}

            <button
              type="button"
              disabled={!canSubmit || decide.isPending}
              onClick={() => decide.mutate()}
              className="min-h-primary w-full rounded-lg bg-teal-700 text-sm font-bold text-white disabled:opacity-50"
            >
              {decide.isPending ? 'Recording…' : `Record ${action.toLowerCase()}`}
            </button>
            {!canSubmit && (
              <p className="mt-1.5 text-[11px] text-ink-soft">
                Approve and Reject need at least one reason code and a note.
              </p>
            )}
          </Card>

          <Card>
            <CardTitle>Four-eyes</CardTitle>
            <p className="text-xs text-ink-soft">
              {caseData.first_approver_id
                ? 'First approval recorded. A different officer must complete the second approval.'
                : 'No first approval yet.'}
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}

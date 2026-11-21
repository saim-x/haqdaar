import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { ApiError, errorMessage } from '../../shared/api/errors';
import type { OfficerCaseReview } from '../../shared/api/types';
import {
  Card,
  CardTitle,
  Chip,
  ConfidenceBar,
  ErrorState,
  flagWord,
  humanize,
  Loading,
  PageHeader,
  statusWord,
  stepWord,
} from '../ui';
import { IconLock, IconWarning } from '../../shared/ui/Icons';
import { FactTable, RuleTraceTable, WhyThisRoute } from './CaseEvidence';

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
  { key: 'APPROVE', label: 'Approve', on: 'border-positive/40 bg-positive-wash text-positive' },
  { key: 'REQUEST_INFO', label: 'Request info', on: 'border-warn/40 bg-warn-wash text-warn' },
  { key: 'REJECT', label: 'Reject', on: 'border-negative/40 bg-negative-wash text-negative' },
  { key: 'ESCALATE', label: 'Escalate', on: 'border-ink/25 bg-raised text-ink' },
] as const;

type ActionKey = (typeof ACTIONS)[number]['key'];

/**
 * Officer case review — docs/11 §6.1.
 * Two columns: evidence on the left, decision on the right. A withdrawn consent
 * replaces the whole screen with a lock view that contains zero PII.
 *
 * The decision panel is deliberately the narrow column: the officer's job is to
 * read the evidence first, and a wide form invites deciding before reading.
 */
export default function CaseReviewPage({ caseId }: { caseId?: string } = {}) {
  const params = useParams();
  const id = caseId ?? params.id ?? '';
  const queryClient = useQueryClient();
  const [action, setAction] = useState<ActionKey>('APPROVE');
  const [reasonCodes, setReasonCodes] = useState<string[]>([]);
  const [requestedFields, setRequestedFields] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [banner, setBanner] = useState<{ tone: 'ok' | 'danger' | 'warn'; text: string } | null>(
    null,
  );

  const query = useQuery({
    queryKey: ['officer-case', id],
    queryFn: () => api.get<OfficerCaseReview>(`/officer/cases/${id}`),
    retry: (count, err) => !(err instanceof ApiError && err.isConsentRevoked) && count < 2,
  });

  const decide = useMutation({
    mutationFn: () =>
      api.post(`/officer/cases/${id}/decide`, {
        action,
        reason_codes: reasonCodes,
        note,
        requested_fields: action === 'REQUEST_INFO' ? requestedFields : [],
        override_amount_pkr: null,
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

  // docs/05 §3.6 — `facts` is the canonical tri-state bundle. Older payloads
  // only carry `draft_answers`, which has the same shape minus `state`.
  const facts = useMemo(() => caseData?.facts ?? caseData?.draft_answers ?? {}, [caseData]);
  const ruleTrace = caseData?.rule_trace ?? [];
  const highFlags = (caseData?.flags ?? []).filter((f) => f.severity === 'HIGH');
  const ruleStale = caseData?.rule_stale === true;

  if (query.isLoading) return <Loading label="Loading case…" />;

  if (consentRevoked) {
    return (
      <div className="mx-auto max-w-xl">
        <Card className="border-paused/30 bg-paused-wash text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-paused text-white">
            <IconLock size={24} />
          </div>
          <h1 className="text-title font-medium text-paused">Citizen withdrew consent</h1>
          <p className="mt-2 text-caption leading-[1.7] text-ink">
            Access is blocked and the attempt has been logged. This case is now{' '}
            <span className="font-mono font-medium">ON_HOLD_CONSENT</span>.
          </p>
          <p className="mt-3 text-meta leading-[1.7] text-ink-3">
            No personal data is shown on this screen. The citizen can re-grant access at any time
            and the case resumes from where it stopped.
          </p>
          <Link
            to="/staff/queue"
            className="press mt-5 inline-flex min-h-[36px] items-center rounded-control border border-ink/[0.14] bg-card px-3 text-caption text-ink hover:bg-raised"
          >
            Back to queue
          </Link>
        </Card>
      </div>
    );
  }

  if (query.error) return <ErrorState error={query.error} />;
  if (!caseData) return <ErrorState error={new Error('Case not found')} />;

  const needsReason = action === 'REJECT' || action === 'APPROVE';
  const needsFields = action === 'REQUEST_INFO';
  const canSubmit =
    (!needsReason || (reasonCodes.length > 0 && note.trim().length > 0)) &&
    (!needsFields || requestedFields.length > 0);

  const bannerSkin =
    banner?.tone === 'ok'
      ? 'border-positive/25 bg-positive-wash text-positive'
      : banner?.tone === 'warn'
        ? 'border-warn/25 bg-warn-wash text-warn'
        : 'border-negative/25 bg-negative-wash text-negative';

  return (
    <div>
      <PageHeader
        title={caseData.reference_code}
        subtitle={[
          caseData.citizen?.full_name ?? 'Applicant',
          caseData.citizen?.cnic_masked,
          caseData.status_label?.label_en ?? statusWord(caseData.status),
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            <button
              type="button"
              onClick={() => assign.mutate()}
              disabled={assign.isPending}
              className="press inline-flex min-h-[36px] items-center rounded-control border border-ink/[0.14] bg-card px-3 text-caption text-ink hover:bg-raised disabled:opacity-50"
            >
              Assign to me
            </button>
            <Link
              to="/staff/queue"
              className="press inline-flex min-h-[36px] items-center rounded-control px-3 text-caption text-ink-2 hover:bg-raised hover:text-ink"
            >
              Back to queue
            </Link>
          </>
        }
      />

      {banner && (
        <div
          role="status"
          className={`mb-4 rounded-control border px-4 py-2.5 text-caption font-medium ${bannerSkin}`}
        >
          {banner.text}
        </div>
      )}

      {ruleStale && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-control border border-warn/25 bg-warn-wash px-4 py-2.5">
          <IconWarning size={14} className="shrink-0 text-warn" />
          <p className="flex-1 text-caption leading-[1.7] text-warn">
            This case was evaluated with an older rule version. Re-evaluate before deciding so the
            decision is reproducible against the active rules.
          </p>
          <button
            type="button"
            onClick={() => reevaluate.mutate()}
            disabled={reevaluate.isPending}
            className="press inline-flex min-h-[32px] items-center rounded-[7px] border border-warn/40 bg-card px-2.5 text-meta font-medium text-warn hover:bg-warn-wash disabled:opacity-50"
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
              <div className="grid gap-5 border-t border-ink/[0.08] pt-3 sm:grid-cols-3">
                {[
                  {
                    label: 'Verified',
                    dot: 'bg-positive',
                    items: caseData.ai_case_note.verified,
                  },
                  {
                    label: 'Uncertain',
                    dot: 'bg-warn',
                    items: caseData.ai_case_note.uncertain,
                  },
                  {
                    label: 'Suggested checks',
                    dot: 'bg-info',
                    items: caseData.ai_case_note.suggested_checks,
                  },
                ].map((group) => (
                  <div key={group.label}>
                    <p className="flex items-center gap-1.5 text-meta text-ink-2">
                      <span className={`live-dot ${group.dot}`} aria-hidden />
                      {group.label}
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {group.items.map((item) => (
                        <li key={item} className="text-caption leading-[1.6] text-ink">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-caption text-ink-3">No handoff note recorded for this case.</p>
            )}
          </Card>

          <FactTable facts={facts} />

          {ruleTrace.length > 0 ? (
            <RuleTraceTable trace={ruleTrace} />
          ) : (
            <WhyThisRoute
              route={caseData.latest_route}
              confidence={caseData.latest_confidence}
              priorityBand={caseData.priority_band}
              priorityScore={caseData.priority_score}
              flags={caseData.flags ?? []}
            />
          )}

          <Card className="p-0">
            <div className="flex items-baseline justify-between gap-3 border-b border-ink/[0.08] px-4 py-3">
              <h2 className="text-body font-medium text-ink">Documents</h2>
              <p className="text-meta text-ink-3">Blur · QR HMAC · OCR vs QR</p>
            </div>
            <ul>
              {caseData.documents.map((doc) => (
                <li key={doc.id} className="border-b border-ink/[0.06] px-4 py-3 last:border-b-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-caption font-medium text-ink">
                      {humanize(doc.doc_type)}
                    </span>
                    <Chip
                      tone={
                        doc.verify_status === 'VERIFIED'
                          ? 'ok'
                          : doc.verify_status === 'TAMPER_SUSPECTED'
                            ? 'danger'
                            : 'warn'
                      }
                    >
                      {humanize(doc.verify_status)}
                    </Chip>
                    <a
                      href={`/api/v1/documents/${doc.id}/file`}
                      target="_blank"
                      rel="noreferrer"
                      className="ms-auto text-meta text-accent-ink hover:underline"
                    >
                      Open file
                    </a>
                  </div>
                  {doc.verify_checks && doc.verify_checks.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {doc.verify_checks.map((check) => (
                        <li
                          key={check.check}
                          className="flex items-center gap-2 text-meta text-ink-2"
                        >
                          <Chip tone={check.passed ? 'ok' : 'danger'}>
                            {check.passed ? 'pass' : 'fail'}
                          </Chip>
                          <span>{humanize(check.check)}</span>
                          {check.value !== undefined && (
                            <span className="num font-mono text-ink-3">{String(check.value)}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
              {caseData.documents.length === 0 && (
                <li className="px-4 py-3 text-caption text-ink-3">No documents attached.</li>
              )}
            </ul>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardTitle hint={`${caseData.flags?.length ?? 0} active`}>Risk flags</CardTitle>
              <ul className="space-y-1.5">
                {(caseData.flags ?? []).map((flag) => (
                  <li key={flag.code} className="flex items-center gap-2">
                    <span
                      className={`live-dot ${
                        flag.severity === 'HIGH'
                          ? 'bg-negative'
                          : flag.severity === 'MEDIUM'
                            ? 'bg-warn'
                            : 'bg-ink-3'
                      }`}
                      aria-hidden
                    />
                    <span className="text-meta text-ink-2">{humanize(flag.severity)}</span>
                    <span className="text-meta text-ink">{flagWord(flag.code)}</span>
                  </li>
                ))}
                {(caseData.flags?.length ?? 0) === 0 && (
                  <li className="text-caption text-ink-3">No flags.</li>
                )}
              </ul>
            </Card>

            <Card>
              <CardTitle hint="pipeline">Agent timeline</CardTitle>
              <ol className="space-y-1.5">
                {(caseData.agent_steps ?? []).map((step) => (
                  <li key={`${step.at}-${step.step}`} className="flex items-center gap-2">
                    <span
                      className={`live-dot ${
                        step.status === 'OK'
                          ? 'bg-positive'
                          : step.status === 'FAILED'
                            ? 'bg-negative'
                            : 'bg-ink-3'
                      }`}
                      aria-hidden
                    />
                    <span className="text-meta text-ink-3">
                      {step.status === 'OK'
                        ? 'ok'
                        : step.status === 'FAILED'
                          ? 'failed'
                          : 'skipped'}
                    </span>
                    <span className="text-meta text-ink">{stepWord(step.step)}</span>
                    <span className="num ms-auto font-mono text-meta text-ink-3">
                      {step.duration_ms}ms
                    </span>
                  </li>
                ))}
                {(caseData.agent_steps?.length ?? 0) === 0 && (
                  <li className="text-caption text-ink-3">No agent steps yet.</li>
                )}
              </ol>
            </Card>
          </div>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <Card>
            <CardTitle>Decision</CardTitle>

            <div className="flex items-center justify-between border-y border-ink/[0.08] py-2">
              <span className="text-meta text-ink-3">Confidence</span>
              <ConfidenceBar value={caseData.latest_confidence ?? null} />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {ACTIONS.map(({ key, label, on }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setAction(key)}
                  aria-pressed={action === key}
                  className={`press min-h-[40px] rounded-control border text-caption ${
                    action === key
                      ? `${on} font-medium`
                      : 'border-ink/[0.12] bg-card text-ink-2 hover:bg-raised hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <p className="mt-4 text-meta text-ink-3">
              Reason codes {needsReason && <span className="text-negative">*</span>}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {REASON_CODES.map((code) => {
                const on = reasonCodes.includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() =>
                      setReasonCodes((prev) =>
                        on ? prev.filter((c) => c !== code) : [...prev, code],
                      )
                    }
                    aria-pressed={on}
                    className={`press rounded-[6px] border px-2 py-1 text-meta ${
                      on
                        ? 'border-accent/40 bg-accent-wash font-medium text-accent-ink'
                        : 'border-ink/[0.12] text-ink-2 hover:bg-raised hover:text-ink'
                    }`}
                  >
                    {humanize(code)}
                  </button>
                );
              })}
            </div>

            {action === 'REQUEST_INFO' && (
              <>
                <p className="mt-4 text-meta text-ink-3">
                  Fields to ask for <span className="text-negative">*</span>
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {Object.keys(caseData.draft_answers ?? {}).map((key) => {
                    const on = requestedFields.includes(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() =>
                          setRequestedFields((prev) =>
                            on ? prev.filter((f) => f !== key) : [...prev, key],
                          )
                        }
                        aria-pressed={on}
                        className={`press rounded-[6px] border px-2 py-1 text-meta ${
                          on
                            ? 'border-warn/40 bg-warn-wash font-medium text-warn'
                            : 'border-ink/[0.12] text-ink-2 hover:bg-raised hover:text-ink'
                        }`}
                      >
                        {humanize(key)}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <label htmlFor="note" className="mt-4 block text-meta text-ink-3">
              Note {needsReason && <span className="text-negative">*</span>}
            </label>
            <textarea
              id="note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1.5 text-caption"
              placeholder="Explain the decision. The citizen sees a plain-language version."
            />

            {highFlags.length > 0 && (
              <p className="mt-3 rounded-control border border-warn/25 bg-warn-wash px-3 py-2 text-meta leading-[1.7] text-warn">
                HIGH flag present: your approval sends this case to a second officer.
              </p>
            )}

            <button
              type="button"
              disabled={!canSubmit || decide.isPending}
              onClick={() => decide.mutate()}
              className="press mt-4 min-h-primary w-full rounded-control bg-accent text-body font-medium text-white hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-45"
            >
              {decide.isPending ? 'Recording…' : `Record ${action.toLowerCase()}`}
            </button>
            {!canSubmit && (
              <p className="mt-2 text-meta leading-[1.7] text-ink-3">
                Approve and Reject need at least one reason code and a note. Request info needs at
                least one field.
              </p>
            )}
          </Card>

          <Card>
            <CardTitle>Four-eyes</CardTitle>
            <p className="text-caption leading-[1.7] text-ink-2">
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

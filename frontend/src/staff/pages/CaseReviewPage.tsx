import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../shared/api/client';
import { ApiError, errorMessage } from '../../shared/api/errors';
import { useAuth } from '../../shared/auth/AuthProvider';
import type { CaseStatus, OfficerCaseReview } from '../../shared/api/types';
import { getAccessToken } from '../../shared/auth/session';
import { API_BASE } from '../../shared/config';
import {
  Card,
  CardTitle,
  Chip,
  ConfidenceBar,
  ErrorState,
  factLabel,
  flagWord,
  humanize,
  Loading,
  PageHeader,
  statusWord,
  stepWord,
} from '../ui';
import { IconLock, IconWarning } from '../../shared/ui/Icons';
import { FactTable, isRuleCheck, reviewFacts, RuleTraceTable, WhyThisRoute } from './CaseEvidence';

const REASON_CODES = {
  DOCUMENT_ILLEGIBLE: 'Document is hard to read',
  INCOME_CONFLICT: 'Income records disagree',
  IDENTITY_AMBIGUOUS: 'Identity could not be confirmed',
  DUPLICATE_SUSPECTED: 'Possible duplicate application',
  PAYOUT_MISMATCH: 'Payment details do not match',
  CONSENT_LOW_ASSURANCE: 'Permission needs checking',
  POLICY_DISCRETION: 'Program rules require judgment',
  OTHER: 'Other',
};

const REQUESTABLE_FIELDS = [
  'applicant_full_name',
  'applicant_cnic',
  'applicant_dob',
  'spouse_full_name',
  'spouse_cnic',
  'applicant_district',
  'children_under_18',
  'household_size',
  'monthly_income_pkr',
  'payout_phone',
  'cnic_doc_verified',
  'death_cert_doc_verified',
];

function formatCheckValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof obj.laplacian_var === 'number') parts.push(`sharpness ${obj.laplacian_var.toFixed(1)}`);
    if (typeof obj.width === 'number' && typeof obj.height === 'number') {
      parts.push(`${obj.width}×${obj.height}px`);
    }
    if (typeof obj.cnic_match === 'boolean') parts.push(`CNIC ${obj.cnic_match ? 'match' : 'mismatch'}`);
    if (typeof obj.name_similarity === 'number') {
      parts.push(`name ${(obj.name_similarity * 100).toFixed(0)}%`);
    }
    if (Array.isArray(obj.fields)) parts.push(`fields: ${obj.fields.join(', ')}`);
    if (typeof obj.confidence === 'number') parts.push(`conf ${(obj.confidence * 100).toFixed(0)}%`);
    if (parts.length > 0) return parts.join(' · ');
    return JSON.stringify(obj);
  }
  return String(value);
}

const ACTIONS = [
  { key: 'APPROVE', label: 'Approve', on: 'border-positive/40 bg-positive-wash text-positive' },
  { key: 'REQUEST_INFO', label: 'Ask for information', on: 'border-warn/40 bg-warn-wash text-warn' },
  { key: 'REJECT', label: 'Reject', on: 'border-negative/40 bg-negative-wash text-negative' },
  { key: 'ESCALATE', label: 'Return for review', on: 'border-ink/25 bg-raised text-ink' },
] as const;

type ActionKey = (typeof ACTIONS)[number]['key'];

// Older and seeded handoff notes contain prose instead of field references.
const HANDOFF_FIELDS: [RegExp, string][] = [
  [/\bincome\b|DATA_CONFLICT_INCOME/i, 'monthly_income_pkr'],
  [/date of birth|applicant_dob/i, 'applicant_dob'],
  [/spouse(?:'s)? name|spouse_full_name/i, 'spouse_full_name'],
  [/applicant(?:'s)? name|registry name|registered name|spelling variant|IDENTITY_CONFLICT|IDENTITY_NAME_VARIANT_CHECK/i, 'applicant_full_name'],
  [/\bcnic\b|POSSIBLE_DUPLICATE_IDENTITY|DUPLICATE_APPLICATION/i, 'applicant_cnic'],
  [/payout|raast|alias|retry the payment/i, 'payout_phone'],
  [/household (?:size|composition)/i, 'household_size'],
  [/death record|death certificate/i, 'spouse_death_verified'],
  [/applicant(?:_is_alive| recorded deceased)|APPLICANT_DECEASED/i, 'applicant_is_alive'],
  [/consent/i, 'citizen_has_active_dept_consent'],
];

function BackToCases() {
  return (
    <Link
      to="/staff/queue"
      className="press mb-2 inline-flex min-h-[36px] items-center rounded-control px-3 text-caption font-medium text-accent-ink hover:bg-raised"
    >
      Back to cases
    </Link>
  );
}

/**
 * Officer case review - docs/11 §6.1.
 * Two columns: evidence on the left, decision on the right. A withdrawn consent
 * replaces the whole screen with a lock view that contains zero PII.
 *
 * The decision panel is deliberately the narrow column: the officer's job is to
 * read the evidence first, and a wide form invites deciding before reading.
 */
export default function CaseReviewPage({ caseId }: { caseId?: string } = {}) {
  const params = useParams();
  const id = caseId ?? params.id ?? '';
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [selectedAction, setAction] = useState<ActionKey | null>(null);
  const [reasonCodes, setReasonCodes] = useState<string[]>([]);
  const [requestedFields, setRequestedFields] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [banner, setBanner] = useState<{ tone: 'ok' | 'danger' | 'warn'; text: string } | null>(
    null,
  );
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (banner) bannerRef.current?.focus();
  }, [banner]);

  const query = useQuery({
    queryKey: ['officer-case', id],
    queryFn: () => api.get<OfficerCaseReview>(`/officer/cases/${id}`),
    retry: (count, err) => !(err instanceof ApiError && err.isConsentRevoked) && count < 2,
  });
  const secondReview = query.data?.status === 'PENDING_SECOND_APPROVAL';
  const firstApprover = secondReview && query.data?.first_approver_id === session?.user.id;
  const availableActions = secondReview
    ? ACTIONS.filter(({ key }) => key === 'REJECT' || (key === 'APPROVE' && !firstApprover))
    : ACTIONS;
  const action = availableActions.find(({ key }) => key === selectedAction)?.key ?? null;

  const decide = useMutation({
    mutationFn: () =>
      api.post<{ status: CaseStatus }>(`/officer/cases/${id}/decide`, {
        action,
        reason_codes: reasonCodes,
        note,
        requested_fields: action === 'REQUEST_INFO' ? requestedFields : [],
        override_amount_pkr: null,
      }),
    onSuccess: ({ status }) => {
      queryClient.setQueryData<OfficerCaseReview>(['officer-case', id], (current) =>
        current ? {
          ...current,
          status,
          status_label: undefined,
          first_approver_id: status === 'PENDING_SECOND_APPROVAL' ? session?.user.id : current.first_approver_id,
        } : current,
      );
      setAction(null);
      setReasonCodes([]);
      setRequestedFields([]);
      setNote('');
      setBanner({ tone: 'ok', text: `Decision saved. ${statusWord(status)}.` });
      void queryClient.invalidateQueries({ queryKey: ['officer-case', id] });
      void queryClient.invalidateQueries({ queryKey: ['officer-queue'] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'SAME_OFFICER') {
        setBanner({
          tone: 'danger',
          text: 'You gave the first approval. A different officer must give the second.',
        });
        return;
      }
      setBanner({ tone: 'danger', text: errorMessage(err, 'en') });
    },
  });

  const assign = useMutation({
    mutationFn: () => api.post<{ status: CaseStatus }>(`/officer/cases/${id}/assign`),
    onSuccess: ({ status }) => {
      queryClient.setQueryData<OfficerCaseReview>(['officer-case', id], (current) =>
        current ? { ...current, status, status_label: undefined } : current,
      );
      setBanner({ tone: 'ok', text: 'Review started. This case is now in My cases.' });
      void queryClient.invalidateQueries({ queryKey: ['officer-case', id] });
      void queryClient.invalidateQueries({ queryKey: ['officer-queue'] });
    },
    onError: (err) => setBanner({ tone: 'danger', text: errorMessage(err, 'en') }),
  });

  const reevaluate = useMutation({
    mutationFn: () => api.post(`/officer/cases/${id}/reevaluate`, {}),
    onSuccess: () => {
      setBanner({ tone: 'ok', text: 'Case checked against the current program rules.' });
      void queryClient.invalidateQueries({ queryKey: ['officer-case', id] });
    },
    onError: (err) => setBanner({ tone: 'danger', text: errorMessage(err, 'en') }),
  });

  async function openDocumentFile(docId: string) {
    try {
      const token = getAccessToken();
      const res = await fetch(`${API_BASE}/documents/${docId}/file`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setBanner({ tone: 'danger', text: errorMessage(err, 'en') });
    }
  }

  const consentRevoked = [query.error, decide.error, assign.error, reevaluate.error]
    .some((error) => error instanceof ApiError && error.isConsentRevoked);
  const caseData = query.data;

  // A saved officer decision wraps the application fields in its audit snapshot.
  const facts = useMemo(() => reviewFacts(caseData?.facts, caseData?.draft_answers), [caseData]);
  const ruleTrace = caseData?.rule_trace?.filter(isRuleCheck) ?? [];
  const needsSecondApproval = caseData?.priority_band === 'HIGH' || caseData?.priority_band === 'URGENT';
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
            This case is on hold until the applicant gives permission again. The access attempt was recorded.
          </p>
          <p className="mt-3 text-meta leading-[1.7] text-ink-3">
            You can return to your list of cases.
          </p>
          <BackToCases />
        </Card>
      </div>
    );
  }

  if (query.error) return (
    <div>
      <BackToCases />
      {banner?.tone === 'ok' && <p role="status" className="mb-3 text-positive">{banner.text}</p>}
      <ErrorState error={query.error} />
    </div>
  );
  if (!caseData) return <><BackToCases /><ErrorState error={new Error('Case not found')} /></>;

  const needsReason = action === 'REJECT' || action === 'APPROVE';
  const needsFields = action === 'REQUEST_INFO';
  const unresolvedRules = ruleTrace.filter((entry) => entry.result === 'FAIL' || entry.result === 'UNKNOWN');
  const conflictingFacts = Object.values(facts).filter((fact) => fact.conflict).length;
  const reviewInProgress = ['HUMAN_REVIEW', 'IN_REVIEW', 'NEEDS_INFO', 'PENDING_SECOND_APPROVAL'].includes(caseData.status);
  const canAssign = caseData.status === 'HUMAN_REVIEW';
  const canDecide = caseData.status === 'IN_REVIEW' || secondReview;
  const canSubmit =
    action !== null && (!needsReason || (reasonCodes.length > 0 && note.trim().length > 0)) &&
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
          statusWord(caseData.status),
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={<BackToCases />}
      />

      {banner && (
        <div
          ref={bannerRef}
          tabIndex={-1}
          role={banner.tone === 'danger' ? 'alert' : 'status'}
          className={`mb-4 rounded-control border px-4 py-2.5 text-caption font-medium ${bannerSkin}`}
        >
          {banner.text}
        </div>
      )}

      {ruleStale && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-control border border-warn/25 bg-warn-wash px-4 py-2.5">
          <IconWarning size={14} className="shrink-0 text-warn" />
          <p className="flex-1 text-caption leading-[1.7] text-warn">
            The program rules have changed. Check the case again before making a decision.
          </p>
          <button
            type="button"
            onClick={() => reevaluate.mutate()}
            disabled={reevaluate.isPending}
            className="press inline-flex min-h-[32px] items-center rounded-[7px] border border-warn/40 bg-card px-2.5 text-meta font-medium text-warn hover:bg-warn-wash disabled:opacity-50"
          >
            {reevaluate.isPending ? 'Checking…' : 'Check again'}
          </button>
        </div>
      )}

      {(canAssign || canDecide) && (
        <a href="#case-decision" className="mb-3 inline-flex min-h-tap items-center text-caption font-medium text-accent-ink underline xl:hidden">
          Go to case decision
        </a>
      )}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {reviewInProgress && (
            <Card className="border-accent/25 bg-accent-wash">
              <CardTitle>What happens next?</CardTitle>
              {caseData.status === 'NEEDS_INFO' ? (
                <p className="text-body text-ink-2">The case is waiting for the information already requested from the citizen.</p>
              ) : caseData.status === 'PENDING_SECOND_APPROVAL' ? (
                <p className="text-body text-ink-2">A different officer needs to review the case and record the second decision.</p>
              ) : (
                <p className="text-body text-ink-2">
                  {conflictingFacts > 0
                    ? 'Compare the conflicting records and their sources before deciding.'
                    : 'Check the application and documents before you record a decision.'}
                </p>
              )}
              {unresolvedRules.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 ps-5 text-caption text-ink-2">
                  {unresolvedRules.slice(0, 3).map((entry) => (
                    <li key={entry.rule_id}>
                      {entry.reason_en || entry.label_en || 'This check needs a closer look.'}
                      {entry.fact && Object.hasOwn(facts, entry.fact) && (
                        <> <a href={`#case-fact-${entry.fact}`} className="font-medium text-accent-ink underline">
                          See {factLabel(entry.fact)}
                        </a></>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <a href="#case-review-evidence" className="mt-2 inline-flex min-h-tap items-center text-caption font-medium text-accent-ink underline">
                See application details
              </a>
            </Card>
          )}
          <Card>
            <CardTitle>Case summary</CardTitle>
            {caseData.ai_case_note ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  {
                    label: 'What to check next',
                    marker: 'bg-info',
                    skin: 'border-info/20 bg-raised/60 sm:col-span-2',
                    empty: 'No follow-up checks suggested.',
                    items: caseData.ai_case_note.suggested_checks,
                  },
                  {
                    label: 'Needs verification',
                    marker: 'bg-warn',
                    skin: 'border-warn/25 bg-warn-wash/50',
                    empty: 'No uncertainties recorded.',
                    items: caseData.ai_case_note.uncertain,
                  },
                  {
                    label: 'Verified',
                    marker: 'bg-positive',
                    skin: 'border-positive/20 bg-positive-wash/50',
                    empty: 'No findings marked as verified.',
                    items: caseData.ai_case_note.verified,
                  },
                ].map(({ label, marker, skin, empty, items }) => (
                  <section key={label} className={`min-w-0 rounded-control border p-3 sm:p-4 ${skin}`}>
                    <h3 className="flex items-center gap-2 text-caption font-semibold text-ink">
                      <span className={`live-dot ${marker}`} aria-hidden />
                      {label}
                    </h3>
                    {items.length === 0 ? (
                      <p className="mt-2 text-caption text-ink-2">{empty}</p>
                    ) : (
                      <ul className="mt-2 divide-y divide-ink/[0.08]">
                        {items.map((item) => {
                          const rule = ruleTrace.find((entry) =>
                            item.startsWith(`${entry.rule_id}:`) ||
                            item.includes(`rule ${entry.rule_id}:`) ||
                            item === `Ask the applicant for: ${entry.ask_prompt_en || entry.label_en}`,
                          );
                          const fact = rule?.fact;
                          const conflictFact = item.match(/^CONFLICTING_FACT_(.+)$/i)?.[1]?.toLowerCase();
                          const document = /printed name|signed QR|CNIC (?:image|photo)|TAMPER_SUSPECTED/i.test(item)
                            ? caseData.documents.find((doc) => doc.doc_type === 'CNIC_FRONT' && doc.verify_status === 'TAMPER_SUSPECTED')
                              ?? caseData.documents.find((doc) => doc.doc_type === 'CNIC_FRONT')
                            : undefined;
                          const exactField = fact ?? conflictFact;
                          const relatedFields = exactField && Object.hasOwn(facts, exactField)
                            ? [exactField]
                            : HANDOFF_FIELDS.filter(([pattern]) => pattern.test(item)).map(([, key]) => key);
                          const visibleFields = relatedFields.filter((key) =>
                            Object.hasOwn(facts, key) && (!document || key !== 'applicant_cnic'),
                          );
                          const prefix = rule ? `${rule.rule_id}:` : '';
                          const description = prefix && item.startsWith(prefix)
                            ? item.slice(prefix.length).trim()
                            : item;
                          return (
                            <li key={item} className="break-words py-2 text-caption leading-relaxed text-ink first:pt-0 last:pb-0">
                              <p>{description || item}</p>
                              <div className="flex flex-wrap gap-x-4">
                                {document && (
                                  <a href={`#case-document-${document.id}`} className="mt-1 inline-flex min-h-8 items-center font-medium text-accent-ink underline">
                                    See CNIC document
                                  </a>
                                )}
                                {visibleFields.map((key) => (
                                  <a key={key} href={`#case-fact-${key}`} className="mt-1 inline-flex min-h-8 items-center font-medium text-accent-ink underline">
                                    See {factLabel(key)}
                                  </a>
                                ))}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                ))}
              </div>
            ) : (
              <p className="text-caption text-ink-2">A case summary is not available yet. <a href="#case-review-evidence" className="font-medium text-accent-ink underline">See application details</a></p>
            )}
          </Card>

          <div id="case-review-evidence" className="scroll-mt-24">
            <FactTable facts={facts} />
          </div>


          <Card className="p-0">
            <div className="flex items-baseline justify-between gap-3 border-b border-ink/[0.08] px-4 py-3">
              <h2 className="text-body font-medium text-ink">Documents</h2>
              <p className="text-meta text-ink-3">Blur · QR HMAC · OCR vs QR</p>
            </div>
            <ul>
              {caseData.documents.map((doc) => (
                <li id={`case-document-${doc.id}`} key={doc.id} className="scroll-mt-24 border-b border-ink/[0.06] px-4 py-3 last:border-b-0 target:bg-accent-wash">
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
                    <button
                      type="button"
                      onClick={() => void openDocumentFile(doc.id)}
                      className="press ms-auto text-meta font-medium text-accent-ink hover:underline"
                    >
                      Open file
                    </button>
                  </div>
                  {doc.verify_checks && doc.verify_checks.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-meta text-ink-2">Document checks</summary>
                      <ul className="mt-2 space-y-1">
                        {doc.verify_checks.map((check) => (
                          <li
                            key={check.check}
                            className="flex flex-wrap items-center gap-2 text-meta text-ink-2"
                          >
                            <Chip tone={check.passed ? 'ok' : 'danger'}>
                              {check.passed ? 'pass' : 'fail'}
                            </Chip>
                            <span>{humanize(check.check)}</span>
                            {check.value !== undefined && check.value !== null && (
                              <span className="num font-mono text-ink-3">
                                {formatCheckValue(check.value)}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
              {caseData.documents.length === 0 && (
                <li className="px-4 py-3 text-caption text-ink-3">No documents attached.</li>
              )}
            </ul>
          </Card>

          <Card>
              <CardTitle>Things to check</CardTitle>
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
                  <li className="text-caption text-ink-3">Nothing extra to check.</li>
                )}
              </ul>
          </Card>
          <details className="rounded-panel border border-ink/[0.10] bg-card px-4 py-3">
            <summary className="cursor-pointer font-medium text-ink">System checks and history</summary>
            <div className="mt-3 space-y-4">
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
              <Card>
                <CardTitle>System activity</CardTitle>
                <ol className="space-y-1.5">
                  {(caseData.agent_steps ?? []).map((step, idx) => {
                    const ms = step.latency_ms ?? step.duration_ms;
                    return (
                      <li key={step.id ?? `${step.created_at ?? step.at ?? idx}-${step.step}`} className="flex items-center gap-2">
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
                        <span className="min-w-0 flex-1 truncate text-meta text-ink">
                          {stepWord(step.step)}
                        </span>
                        {ms !== null && ms !== undefined && (
                          <span className="num ms-auto font-mono text-meta text-ink-3">{ms}ms</span>
                        )}
                      </li>
                    );
                  })}
                  {(caseData.agent_steps?.length ?? 0) === 0 && (
                    <li className="text-caption text-ink-3">No agent steps yet.</li>
                  )}
                </ol>
              </Card>
              <div className="flex items-center justify-between border-y border-ink/[0.08] py-2">
                <span className="text-meta text-ink-3">Confidence in the records</span>
                <ConfidenceBar value={caseData.latest_confidence ?? null} />
              </div>

              {caseData.confidence_components && (
                <div className="mt-2.5 space-y-1.5 rounded-control bg-raised/60 p-2.5">
                  {(() => {
                    const cc = caseData.confidence_components;
                    const pillars = [
                      { label: 'Identity', val: cc.identity },
                      { label: 'Documents', val: cc.documents },
                      { label: 'Data consistency', val: cc.data_consistency },
                      { label: 'Permission', val: cc.consent_assurance },
                    ];
                    const minVal = Math.min(...pillars.map((p) => p.val));
                    return pillars.map((p) => {
                      const isWeakest = Math.abs(p.val - minVal) < 0.001 && minVal < 0.9;
                      return (
                        <div key={p.label}>
                          <div className="flex items-center justify-between text-[11px]">
                            <span className={isWeakest ? 'font-medium text-negative' : 'text-ink-2'}>
                              {p.label}
                              {isWeakest ? ' (needs checking)' : ''}
                            </span>
                            <span className="num font-mono text-ink">{(p.val * 100).toFixed(0)}%</span>
                          </div>
                          <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-ink/[0.08]">
                            <div
                              className={`h-full ${
                                p.val >= 0.9 ? 'bg-positive' : p.val >= 0.7 ? 'bg-warn' : 'bg-negative'
                              }`}
                              style={{ width: `${Math.round(p.val * 100)}%` }}
                            />
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}

            </div>
          </details>
        </div>

        <aside id="case-decision" className="scroll-mt-24 space-y-4 xl:sticky xl:top-4 xl:self-start">
          <Card>
            <CardTitle>Case decision</CardTitle>

            {canAssign ? (
              <>
                <p className="text-caption leading-[1.7] text-ink-2">
                  Start the review to add this case to My cases and open the decision form.
                </p>
                <button
                  type="button"
                  onClick={() => assign.mutate()}
                  disabled={assign.isPending}
                  className="press mt-3 min-h-primary w-full rounded-control bg-accent px-4 text-body font-medium text-white hover:bg-accent-ink disabled:opacity-50"
                >
                  {assign.isPending ? 'Starting review…' : 'Start review'}
                </button>
              </>
            ) : !canDecide ? (
              <div className="space-y-2">
                <p className="text-caption text-ink-2">Current status: {statusWord(caseData.status)}.</p>
                <BackToCases />
              </div>
            ) : <>
              {firstApprover && (
                <p className="mt-3 text-caption text-ink-2">You recorded the first approval. A different officer can record the second.</p>
              )}
              <p className="mt-2 text-caption text-ink-2">Choose what should happen to this application.</p>
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                {availableActions.map(({ key, label, on }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAction(key)}
                    disabled={decide.isPending}
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

              {action && <>
                <p className="mt-4 text-meta text-ink-3">
                  Reason for decision {needsReason && <span className="text-negative">*</span>}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {Object.entries(REASON_CODES).map(([code, label]) => {
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
                        {label}
                      </button>
                    );
                  })}
                </div>

                {action === 'REQUEST_INFO' && (
                  <>
                    <p className="mt-4 text-meta text-ink-3">
                      What should the applicant provide? <span className="text-negative">*</span>
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {Array.from(
                        new Set([...REQUESTABLE_FIELDS, ...Object.keys(caseData.draft_answers ?? {})]),
                      ).map((key) => {
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
                            {factLabel(key)}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}

                <label htmlFor="note" className="mt-4 block text-meta text-ink-3">
                  Explanation {needsReason && <span className="text-negative">*</span>}
                </label>
                <textarea
                  id="note"
                  rows={3}
                  maxLength={2000}
                  disabled={decide.isPending}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="mt-1.5 text-caption"
                  placeholder="Write a short explanation."
                />

                {needsSecondApproval && !secondReview && action === 'APPROVE' && (
                  <p className="mt-3 rounded-control border border-warn/25 bg-warn-wash px-3 py-2 text-meta leading-[1.7] text-warn">
                    If you approve this case, a second officer must also approve it before payment.
                  </p>
                )}

                <button
                  type="button"
                  disabled={!canSubmit || decide.isPending}
                  onClick={() => decide.mutate()}
                  className="press mt-4 min-h-primary w-full rounded-control bg-accent text-body font-medium text-white hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {decide.isPending ? 'Saving…' : 'Save decision'}
                </button>
                {!canSubmit && (
                  <p className="mt-2 text-meta leading-[1.7] text-ink-3">
                    {needsFields ? 'Choose at least one item to request.' : 'Choose a reason and write a short explanation.'}
                  </p>
                )}
              </>}
            </>}
          </Card>
        </aside>
      </div>
    </div>
  );
}

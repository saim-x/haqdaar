import type { DraftAnswer, FactObject, FactState, RuleTraceEntry } from '../../shared/api/types';
import { Card, Chip } from '../ui';
import { IconWarning } from '../../shared/ui/Icons';

/**
 * Officer evidence renderers — docs/11 §6.1, docs/04 §5, docs/06 §2.
 *
 * Contract-first: `GET /officer/cases/{id}` documents `facts` and `rule_trace`,
 * but the shipped endpoint may omit either. Every component here is strictly
 * optional — when the field is absent the caller renders the "Why this route"
 * fallback instead, and nothing throws.
 *
 * The visual rule for this file: a KNOWN fact is ink on paper, an UNKNOWN fact
 * is a gap in the paper. So UNKNOWN is drawn as an em-dash with the reason in
 * small type underneath — never as a filled badge, which would make missing
 * information look like a finding.
 */

type FactLike = DraftAnswer | FactObject;

/**
 * Tri-state is NEVER coerced (docs/04 §5).
 *
 * `UNKNOWN` stays `UNKNOWN`. A `false` or a `0` is a real, KNOWN answer and must
 * never be mistaken for "missing" — that is the whole point of the tri-state.
 * Legacy draft answers carry no `state`, so only a null value is treated as
 * UNKNOWN there.
 */
export function resolveFactState(fact: FactLike): FactState {
  if (fact.state === 'KNOWN' || fact.state === 'UNKNOWN') return fact.state;
  return fact.value === null || fact.value === undefined ? 'UNKNOWN' : 'KNOWN';
}

/** Render a known value without ever turning `false`/`0` into a dash. */
export function renderFactValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function sourceTone(source: string | null | undefined): 'ok' | 'info' | 'warn' | 'neutral' {
  if (!source) return 'neutral';
  if (source.includes('REGISTRY')) return 'info';
  if (source.includes('DOCUMENT')) return 'ok';
  if (source.includes('SELF')) return 'warn';
  return 'neutral';
}

function FactRow({ factKey, fact }: { factKey: string; fact: FactLike }) {
  const state = resolveFactState(fact);
  const unknown = state === 'UNKNOWN';
  const alternatives = fact.alternatives ?? [];
  const confidence =
    typeof fact.source_confidence === 'number' && fact.source_confidence > 0
      ? `${Math.round(fact.source_confidence * 100)}%`
      : null;

  return (
    <tr className={fact.conflict ? 'bg-warn-wash' : undefined}>
      <td className="font-mono text-meta text-ink-2">{factKey}</td>
      <td>
        {unknown ? (
          <span className="inline-flex flex-wrap items-baseline gap-2">
            <span className="text-caption text-ink-3">—</span>
            {fact.missing_reason && (
              <span className="text-meta leading-[1.6] text-ink-3">{fact.missing_reason}</span>
            )}
          </span>
        ) : (
          <span className="num font-mono text-caption font-medium text-ink">
            {renderFactValue(fact.value)}
          </span>
        )}
        {fact.conflict && (
          <p className="mt-1">
            <Chip tone="danger">conflict</Chip>
          </p>
        )}
        {alternatives.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {alternatives.map((alt, i) => (
              <li key={`${alt.source}-${i}`} className="text-meta text-ink-3">
                also {renderFactValue(alt.value)} · {alt.source} · {alt.entered_by}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td>
        {fact.source ? (
          <Chip tone={sourceTone(fact.source)}>{fact.source}</Chip>
        ) : (
          <span className="text-caption text-ink-3">—</span>
        )}
        <p className="mt-1 text-meta text-ink-3">
          {fact.entered_by ?? '—'}
          {confidence && <span className="num"> · {confidence}</span>}
        </p>
      </td>
    </tr>
  );
}

/**
 * Canonical facts with provenance, alternatives and conflict highlighting.
 *
 * Three columns, not six. The reading column is ~590px wide, so a six-column
 * table pushed "Entered by" and "Conflict" off the right edge — the officer had
 * to scroll sideways to see who supplied a value, which is exactly the question
 * this table exists to answer. Provenance now stacks under the source chip.
 */
export function FactTable({ facts }: { facts: Record<string, FactLike> }) {
  const entries = Object.entries(facts);
  const conflicts = entries.filter(([, f]) => f.conflict).length;
  const unknowns = entries.filter(([, f]) => resolveFactState(f) === 'UNKNOWN').length;

  return (
    <Card className="p-0">
      <div className="flex items-baseline justify-between gap-3 border-b border-ink/[0.08] px-4 py-3">
        <h2 className="text-body font-medium text-ink">Canonical facts</h2>
        <p className="num text-meta text-ink-3">
          {entries.length} facts · {unknowns} unknown · {conflicts} conflict
          {conflicts === 1 ? '' : 's'}
        </p>
      </div>
      <table className="ledger" data-testid="facts-table">
        <thead>
          <tr>
            <th className="w-[34%]">Fact</th>
            <th>Value</th>
            <th className="w-[30%]">Source</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, fact]) => (
            <FactRow key={key} factKey={key} fact={fact} />
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={3} className="text-caption text-ink-3">
                No facts recorded on this case yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

const RESULT_TONE: Record<string, { dot: string; text: string }> = {
  PASS: { dot: 'bg-positive', text: 'text-positive' },
  FAIL: { dot: 'bg-negative', text: 'text-negative' },
  UNKNOWN: { dot: 'bg-ink-3', text: 'text-ink-3' },
};

const RESULT_FALLBACK = { dot: 'bg-ink-3', text: 'text-ink-3' };

function TraceRow({ entry }: { entry: RuleTraceEntry }) {
  const label = entry.label_en ?? entry.label_ur ?? null;
  const reasonEn = entry.reason_en ?? entry.fail_reason_en ?? entry.pass_reason_en ?? '';
  const reasonUr = entry.reason_ur ?? entry.fail_reason_ur ?? entry.pass_reason_ur ?? '';
  const askEn = entry.result === 'UNKNOWN' ? (entry.ask_prompt_en ?? null) : null;
  const askUr = entry.result === 'UNKNOWN' ? (entry.ask_prompt_ur ?? null) : null;
  const tone = RESULT_TONE[entry.result] ?? RESULT_FALLBACK;
  const expression = entry.fact
    ? `${entry.fact}${entry.op ? ` ${entry.op}` : ''}${
        entry.value !== undefined && entry.value !== null ? ` ${renderFactValue(entry.value)}` : ''
      }`
    : null;

  return (
    <li className="border-b border-ink/[0.06] px-4 py-3 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <span className="font-mono text-meta font-medium text-ink">{entry.rule_id}</span>
          {label && <span className="ms-2 text-caption text-ink">{label}</span>}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5">
          <span className={`live-dot ${tone.dot}`} aria-hidden />
          <span className={`text-meta font-medium ${tone.text}`}>{entry.result}</span>
        </span>
      </div>

      {expression && <p className="mt-1 font-mono text-meta text-ink-3">{expression}</p>}

      <p className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-meta text-ink-2">
        <span>
          actual{' '}
          <span className="num font-mono font-medium text-ink">{renderFactValue(entry.actual)}</span>
        </span>
        <span>
          expected{' '}
          <span className="num font-mono font-medium text-ink">
            {renderFactValue(entry.expected)}
          </span>
        </span>
        {entry.required_for_auto && <span className="text-ink-3">required for auto</span>}
      </p>

      {reasonEn && <p className="mt-1.5 text-caption leading-[1.6] text-ink">{reasonEn}</p>}
      {reasonUr && (
        <p className="mt-0.5 text-caption leading-[1.7] text-ink-2" dir="rtl" lang="ur">
          {reasonUr}
        </p>
      )}
      {askEn && <p className="mt-1.5 text-meta leading-[1.6] text-warn">Asks: {askEn}</p>}
      {askUr && (
        <p className="text-meta leading-[1.7] text-warn" dir="rtl" lang="ur">
          {askUr}
        </p>
      )}

      {(entry.on_fail || entry.on_unknown) && (
        <p className="mt-1.5 flex flex-wrap gap-x-4 font-mono text-meta text-ink-3">
          {entry.on_fail && <span>fail → {entry.on_fail}</span>}
          {entry.on_unknown && <span>unknown → {entry.on_unknown}</span>}
        </p>
      )}
    </li>
  );
}

/**
 * Per-rule PASS / FAIL / UNKNOWN trace. Rendered only when the backend supplies
 * `rule_trace`; the caller falls back to "Why this route" otherwise.
 *
 * A list, not a table. Five columns of prose (rule, result, actual/expected,
 * reason EN + UR, policy) cannot fit the reading column, and a horizontally
 * scrolling trace hides the reason — the one thing the officer came to read.
 * Stacked, each rule is one paragraph you finish before moving to the next.
 */
export function RuleTraceTable({ trace }: { trace: RuleTraceEntry[] }) {
  const pass = trace.filter((e) => e.result === 'PASS').length;
  const fail = trace.filter((e) => e.result === 'FAIL').length;
  const unknown = trace.filter((e) => e.result === 'UNKNOWN').length;

  return (
    <Card className="p-0" data-testid="rule-trace">
      <div className="flex items-baseline justify-between gap-3 border-b border-ink/[0.08] px-4 py-3">
        <h2 className="text-body font-medium text-ink">Rule trace</h2>
        <p className="num text-meta text-ink-3">
          {pass} pass · {fail} fail · {unknown} unknown
        </p>
      </div>
      <ul>
        {trace.map((entry, i) => (
          <TraceRow key={`${entry.rule_id}-${i}`} entry={entry} />
        ))}
      </ul>
    </Card>
  );
}

/**
 * Fallback when `rule_trace` is absent: route + confidence + flags, plus a note
 * that the per-rule trace lives on the decision and is visible to auditors.
 */
export function WhyThisRoute({
  route,
  confidence,
  priorityBand,
  priorityScore,
  flags,
}: {
  route: string | null | undefined;
  confidence: number | null | undefined;
  priorityBand: string | null | undefined;
  priorityScore: number | null | undefined;
  flags: { code: string; detail?: string | null }[];
}) {
  return (
    <Card data-testid="rule-trace-fallback">
      <h2 className="text-body font-medium text-ink">Why this route</h2>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 border-t border-ink/[0.08] sm:grid-cols-3">
        <div className="border-b border-ink/[0.06] py-2">
          <dt className="text-meta text-ink-3">Route</dt>
          <dd className="mt-0.5">
            <Chip
              tone={route === 'AUTO_APPROVE' ? 'ok' : route === 'HUMAN_REVIEW' ? 'warn' : 'info'}
            >
              {route ?? '—'}
            </Chip>
          </dd>
        </div>
        <div className="border-b border-ink/[0.06] py-2">
          <dt className="text-meta text-ink-3">Confidence</dt>
          <dd className="num mt-0.5 font-mono text-caption font-medium text-ink">
            {confidence !== null && confidence !== undefined ? confidence.toFixed(3) : '—'}
          </dd>
        </div>
        <div className="border-b border-ink/[0.06] py-2">
          <dt className="text-meta text-ink-3">Priority</dt>
          <dd className="num mt-0.5 font-mono text-caption font-medium text-ink">
            {priorityBand ?? '—'} ({priorityScore ?? '—'})
          </dd>
        </div>
      </dl>

      {flags.length > 0 && (
        <ul className="mt-3 space-y-1">
          {flags.map((flag) => (
            <li key={flag.code} className="text-meta text-ink">
              <span className="font-mono font-medium">{flag.code}</span>
              {flag.detail && <span className="text-ink-3"> — {flag.detail}</span>}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 flex items-start gap-2 text-meta leading-[1.7] text-ink-3">
        <IconWarning size={13} className="mt-1 shrink-0" />
        Per-rule PASS/FAIL/UNKNOWN is recorded on the decision and is available to auditors in the
        decision-trace inspector.
      </p>
    </Card>
  );
}

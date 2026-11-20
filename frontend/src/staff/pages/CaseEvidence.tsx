import type { DraftAnswer, FactObject, FactState, RuleTraceEntry } from '../../shared/api/types';
import { Card, CardTitle, Chip } from '../ui';
import { IconWarning } from '../../shared/ui/Icons';

/**
 * Officer evidence renderers — docs/11 §6.1, docs/04 §5, docs/06 §2.
 *
 * Contract-first: `GET /officer/cases/{id}` documents `facts` and `rule_trace`,
 * but the shipped endpoint may omit either. Every component here is strictly
 * optional — when the field is absent the caller renders the "Why this route"
 * fallback instead, and nothing throws.
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

  return (
    <tr className={`border-b border-ink/5 last:border-0 ${fact.conflict ? 'bg-amber-50' : ''}`}>
      <td className="px-2 py-1.5 font-mono text-[11px] text-ink-soft">{factKey}</td>
      <td className="px-2 py-1.5">
        {unknown ? (
          <span className="inline-flex flex-wrap items-center gap-1">
            <Chip tone="neutral">UNKNOWN</Chip>
            {fact.missing_reason && (
              <span className="font-mono text-[10px] text-ink-soft">{fact.missing_reason}</span>
            )}
          </span>
        ) : (
          <span className="num text-xs font-semibold text-ink">{renderFactValue(fact.value)}</span>
        )}
        {alternatives.length > 0 && (
          <ul className="mt-0.5 space-y-0.5">
            {alternatives.map((alt, i) => (
              <li key={`${alt.source}-${i}`} className="text-[10px] text-ink-soft">
                also {renderFactValue(alt.value)} · {alt.source} · {alt.entered_by}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="px-2 py-1.5">
        <Chip tone={sourceTone(fact.source)}>{fact.source ?? '—'}</Chip>
      </td>
      <td className="px-2 py-1.5 text-[11px] text-ink-soft">{fact.entered_by ?? '—'}</td>
      <td className="num px-2 py-1.5 text-[11px] text-ink-soft">
        {typeof fact.source_confidence === 'number' && fact.source_confidence > 0
          ? `${Math.round(fact.source_confidence * 100)}%`
          : '—'}
      </td>
      <td className="px-2 py-1.5">
        {fact.conflict ? <Chip tone="danger">conflict</Chip> : <span className="text-[11px] text-ink-soft">—</span>}
      </td>
    </tr>
  );
}

/** Canonical facts with provenance, alternatives and conflict highlighting. */
export function FactTable({ facts }: { facts: Record<string, FactLike> }) {
  const entries = Object.entries(facts);
  const conflicts = entries.filter(([, f]) => f.conflict).length;
  const unknowns = entries.filter(([, f]) => resolveFactState(f) === 'UNKNOWN').length;

  return (
    <Card className="overflow-x-auto">
      <CardTitle
        hint={`${entries.length} facts · ${unknowns} unknown · ${conflicts} conflict${conflicts === 1 ? '' : 's'}`}
      >
        Canonical facts
      </CardTitle>
      <table className="w-full min-w-[680px] text-left" data-testid="facts-table">
        <thead>
          <tr className="border-b border-ink/10 text-[10px] uppercase tracking-wide text-ink-soft">
            <th className="px-2 py-1">Fact</th>
            <th className="px-2 py-1">Value</th>
            <th className="px-2 py-1">Source</th>
            <th className="px-2 py-1">Entered by</th>
            <th className="px-2 py-1">Conf.</th>
            <th className="px-2 py-1">Conflict</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, fact]) => (
            <FactRow key={key} factKey={key} fact={fact} />
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={6} className="px-2 py-3 text-xs text-ink-soft">
                No facts recorded on this case yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

function resultTone(result: RuleTraceEntry['result']): 'ok' | 'danger' | 'warn' {
  return result === 'PASS' ? 'ok' : result === 'FAIL' ? 'danger' : 'warn';
}

function TraceRow({ entry }: { entry: RuleTraceEntry }) {
  const label = entry.label_en ?? entry.label_ur ?? null;
  const reasonEn = entry.reason_en ?? entry.fail_reason_en ?? entry.pass_reason_en ?? '';
  const reasonUr = entry.reason_ur ?? entry.fail_reason_ur ?? entry.pass_reason_ur ?? '';
  const askEn = entry.result === 'UNKNOWN' ? entry.ask_prompt_en ?? null : null;
  const askUr = entry.result === 'UNKNOWN' ? entry.ask_prompt_ur ?? null : null;

  return (
    <tr className="border-b border-ink/5 align-top last:border-0">
      <td className="px-2 py-2">
        <p className="font-mono text-[11px] font-semibold text-ink">{entry.rule_id}</p>
        {label && <p className="mt-0.5 text-[11px] text-ink-soft">{label}</p>}
        {entry.fact && (
          <p className="mt-0.5 font-mono text-[10px] text-ink-soft">
            {entry.fact}
            {entry.op ? ` ${entry.op}` : ''}
            {entry.value !== undefined && entry.value !== null ? ` ${renderFactValue(entry.value)}` : ''}
          </p>
        )}
      </td>
      <td className="px-2 py-2">
        <Chip tone={resultTone(entry.result)}>{entry.result}</Chip>
        {entry.required_for_auto && (
          <p className="mt-1 text-[10px] font-semibold uppercase text-ink-soft">required for auto</p>
        )}
      </td>
      <td className="px-2 py-2 text-[11px]">
        <p className="text-ink">
          <span className="text-ink-soft">actual </span>
          <span className="num font-semibold">{renderFactValue(entry.actual)}</span>
        </p>
        <p className="text-ink">
          <span className="text-ink-soft">expected </span>
          <span className="num font-semibold">{renderFactValue(entry.expected)}</span>
        </p>
      </td>
      <td className="px-2 py-2 text-[11px]">
        {reasonEn && <p className="text-ink">{reasonEn}</p>}
        {reasonUr && (
          <p className="mt-0.5 text-ink-soft" dir="rtl">
            {reasonUr}
          </p>
        )}
        {askEn && <p className="mt-1 text-[10px] font-semibold text-amber-700">asks: {askEn}</p>}
        {askUr && (
          <p className="text-[10px] text-amber-700" dir="rtl">
            {askUr}
          </p>
        )}
      </td>
      <td className="px-2 py-2 text-[10px] text-ink-soft">
        {entry.on_fail && <p>fail → {entry.on_fail}</p>}
        {entry.on_unknown && <p>unknown → {entry.on_unknown}</p>}
      </td>
    </tr>
  );
}

/**
 * Per-rule PASS / FAIL / UNKNOWN trace. Rendered only when the backend supplies
 * `rule_trace`; the caller falls back to "Why this route" otherwise.
 */
export function RuleTraceTable({ trace }: { trace: RuleTraceEntry[] }) {
  const pass = trace.filter((e) => e.result === 'PASS').length;
  const fail = trace.filter((e) => e.result === 'FAIL').length;
  const unknown = trace.filter((e) => e.result === 'UNKNOWN').length;

  return (
    <Card className="overflow-x-auto">
      <CardTitle hint={`${pass} pass · ${fail} fail · ${unknown} unknown`}>Rule trace</CardTitle>
      <table className="w-full min-w-[760px] text-left" data-testid="rule-trace">
        <thead>
          <tr className="border-b border-ink/10 text-[10px] uppercase tracking-wide text-ink-soft">
            <th className="px-2 py-1">Rule</th>
            <th className="px-2 py-1">Result</th>
            <th className="px-2 py-1">Actual / expected</th>
            <th className="px-2 py-1">Reason (EN / UR)</th>
            <th className="px-2 py-1">Policy</th>
          </tr>
        </thead>
        <tbody>
          {trace.map((entry, i) => (
            <TraceRow key={`${entry.rule_id}-${i}`} entry={entry} />
          ))}
        </tbody>
      </table>
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
      <CardTitle hint="route + confidence + flags">Why this route</CardTitle>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-soft">Route</span>
          <Chip tone={route === 'AUTO_APPROVE' ? 'ok' : route === 'HUMAN_REVIEW' ? 'warn' : 'info'}>
            {route ?? '—'}
          </Chip>
          <span className="text-ink-soft">Confidence</span>
          <span className="num font-bold text-ink">
            {confidence !== null && confidence !== undefined ? confidence.toFixed(3) : '—'}
          </span>
          <span className="text-ink-soft">Priority</span>
          <span className="num font-bold text-ink">
            {priorityBand ?? '—'} ({priorityScore ?? '—'})
          </span>
        </div>
        {flags.length > 0 && (
          <ul className="space-y-1">
            {flags.map((flag) => (
              <li key={flag.code} className="text-[11px] text-ink">
                <span className="font-mono font-semibold">{flag.code}</span>
                {flag.detail && <span className="text-ink-soft"> — {flag.detail}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="flex items-start gap-1.5 text-[11px] text-ink-soft">
          <IconWarning size={13} className="mt-0.5 shrink-0" />
          Per-rule PASS/FAIL/UNKNOWN is recorded on the decision and is available to auditors in the
          decision-trace inspector.
        </p>
      </div>
    </Card>
  );
}

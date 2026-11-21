import type { HTMLAttributes, ReactNode } from 'react';
import { ApiError } from '../shared/api/errors';

/**
 * Staff console kit. English LTR, dense, keyboard-friendly.
 *
 * The console is where a decision has to be defensible, so the surfaces are
 * flatter and tighter than the citizen app: hairline rules instead of borders,
 * one type step per role, tabular figures everywhere a number can be compared.
 * Nothing here is filled with colour except a semantic dot — a screen with six
 * saturated pills has no hierarchy left to spend on the one row that matters.
 */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-ink/[0.08] pb-4">
      <div className="min-w-0">
        <h1 className="text-title-lg font-medium leading-[1.3] text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-caption text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  children,
  className = '',
  ...rest
}: { children: ReactNode; className?: string } & HTMLAttributes<HTMLElement>) {
  return (
    <section className={`card p-4 ${className}`} {...rest}>
      {children}
    </section>
  );
}

export function CardTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-body font-medium text-ink">{children}</h2>
      {hint && <span className="text-meta text-ink-3">{hint}</span>}
    </div>
  );
}

/** Three static skeleton rows. Nothing in the console is allowed to pulse. */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="py-6" role="status" aria-label={label}>
      <div className="space-y-2">
        {[0, 1, 2].map((row) => (
          <div key={row} className="h-9 rounded-control bg-raised" />
        ))}
      </div>
      <p className="mt-3 text-meta text-ink-3">{label}</p>
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const api = error instanceof ApiError ? error : null;
  return (
    <div
      role="alert"
      className="rounded-control border border-negative/25 bg-negative-wash px-4 py-3"
    >
      <p className="font-mono text-meta font-medium text-negative">{api?.code ?? 'ERROR'}</p>
      <p className="mt-1 text-caption text-ink">{api?.messageEn ?? String(error)}</p>
      {api?.requestId && (
        <p className="mt-1 font-mono text-meta text-ink-3">request {api.requestId}</p>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-control border border-dashed border-ink/[0.14] px-6 py-10 text-center text-caption text-ink-3">
      {children}
    </div>
  );
}

const BAND: Record<string, { dot: string; text: string }> = {
  URGENT: { dot: 'bg-negative', text: 'text-negative' },
  HIGH: { dot: 'bg-warn', text: 'text-warn' },
  NORMAL: { dot: 'bg-ink-3', text: 'text-ink-2' },
  LOW: { dot: 'bg-ink-3', text: 'text-ink-3' },
};

const BAND_FALLBACK = { dot: 'bg-ink-3', text: 'text-ink-2' };

/** Priority is a dot and a word. A filled red block would outrank the case name. */
export function PriorityBand({ band }: { band: string }) {
  const tone = BAND[band] ?? BAND_FALLBACK;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`live-dot ${tone.dot}`} aria-hidden />
      <span className={`text-meta ${tone.text}`}>{band}</span>
    </span>
  );
}

const CHIP_TONES: Record<string, string> = {
  neutral: 'border-ink/[0.12] text-ink-2',
  danger: 'border-negative/30 text-negative',
  warn: 'border-warn/30 text-warn',
  ok: 'border-positive/30 text-positive',
  info: 'border-info/30 text-info',
};

export function Chip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'danger' | 'warn' | 'ok' | 'info';
}) {
  return (
    <span
      className={`inline-flex items-center rounded-[6px] border px-1.5 py-0.5 text-meta ${CHIP_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * Confidence as a 2px track plus the number. The number is the fact; the track
 * is the glance. A null value stays a dash — never a zero-width bar, which would
 * read as "confidently wrong".
 */
export function ConfidenceBar({ value }: { value: number | null }) {
  if (value === null) return <span className="text-meta text-ink-3">—</span>;
  const pct = Math.round(value * 100);
  const tone = value >= 0.9 ? 'bg-positive' : value >= 0.7 ? 'bg-warn' : 'bg-negative';
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-0.5 w-14 overflow-hidden rounded-full bg-ink/[0.10]">
        <span className={`block h-full ${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="num font-mono text-meta text-ink-2">{value.toFixed(2)}</span>
    </span>
  );
}

export function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-meta text-ink-3">{label}</p>
      <p className="num mt-1 text-display font-medium leading-[1.2] text-ink">{value}</p>
      {hint && <p className="mt-1 text-meta text-ink-3">{hint}</p>}
    </div>
  );
}

/** A label/value pair for detail panels. Value keeps its own direction. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-b border-ink/[0.06] py-2 last:border-b-0">
      <dt className="text-meta text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-caption text-ink">{children}</dd>
    </div>
  );
}

import { CircleAlert, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError } from '../shared/api/client';
import type { Flag, PriorityBand, Severity } from '../shared/api/types';
import { cx } from '../shared/ui/cx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{title}</h1>
        {subtitle && (
          <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  children,
  actions,
  className,
  id,
}: {
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <Card id={id} className={cx('rounded-2xl border-border shadow-card', className)}>
      {(title || actions) && (
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-border px-5 py-4">
          {title && <CardTitle className="text-sm font-semibold tracking-tight">{title}</CardTitle>}
          {actions}
        </CardHeader>
      )}
      <CardContent className="p-5">{children}</CardContent>
    </Card>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'ink',
  lead,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'ink' | 'ok' | 'warn' | 'danger' | 'info';
  lead?: boolean;
}) {
  const toneCls = {
    ink: 'text-foreground',
    ok: 'text-ok',
    warn: 'text-warn',
    danger: 'text-danger',
    info: 'text-info',
  }[tone];
  return (
    <Card
      className={cx(
        'rounded-2xl border-border p-5 shadow-card',
        lead && 'bg-primary text-primary-foreground sm:col-span-2',
      )}
    >
      <p
        className={cx(
          'text-xs font-semibold uppercase tracking-wide',
          lead ? 'text-white/75' : 'text-muted-foreground',
        )}
      >
        {label}
      </p>
      <p
        className={cx(
          'num mt-2 font-bold leading-none tracking-tight',
          lead ? 'text-5xl text-white' : cx('text-3xl', toneCls),
        )}
      >
        {value}
      </p>
      {hint && <p className={cx('mt-2 text-sm', lead ? 'text-white/75' : 'text-muted-foreground')}>{hint}</p>}
    </Card>
  );
}

const SEV: Record<Severity, string> = {
  HIGH: 'bg-danger-soft text-danger border-danger/30',
  MEDIUM: 'bg-warn-soft text-warn border-warn/30',
  LOW: 'bg-neutral-soft text-neutral border-neutral/30',
};

export function FlagChip({ flag }: { flag: Flag }) {
  return (
    <span
      title={flag.detail}
      className={cx(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-semibold',
        SEV[flag.severity],
      )}
    >
      <span aria-hidden className="text-[9px]">
        {flag.severity === 'HIGH' ? '▲' : flag.severity === 'MEDIUM' ? '■' : '●'}
      </span>
      {flag.code}
      <span className="sr-only">({flag.severity} severity)</span>
    </span>
  );
}

export function ReasonChip({ code }: { code: string }) {
  return (
    <span className="inline-flex rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground">
      {code}
    </span>
  );
}

const BAND: Record<PriorityBand, string> = {
  URGENT: 'bg-danger text-white',
  HIGH: 'bg-warn text-white',
  NORMAL: 'bg-info-soft text-info',
  LOW: 'bg-neutral-soft text-neutral',
};

export function PriorityBadge({ band, score }: { band: PriorityBand; score?: number }) {
  return (
    <span
      className={cx(
        'inline-flex min-w-[76px] items-center justify-between gap-1 rounded-md px-2 py-0.5 text-xs font-bold',
        BAND[band],
      )}
    >
      {band}
      {score !== undefined && <span className="num opacity-80">{score}</span>}
    </span>
  );
}

/** Horizontal bar with the auto-approve threshold marker. */
export function ConfidenceBar({
  value,
  threshold = 0.9,
  label,
  compact,
}: {
  value: number | null | undefined;
  threshold?: number;
  label?: string;
  compact?: boolean;
}) {
  const v = value ?? 0;
  const tone = v >= threshold ? 'bg-ok' : v >= 0.6 ? 'bg-warn' : 'bg-danger';
  return (
    <div className={cx('w-full', compact ? 'min-w-[90px]' : '')}>
      {label && (
        <div className="mb-1 flex justify-between text-xs">
          <span className="font-semibold">{label}</span>
          <span className="num font-mono">{value === null || value === undefined ? '—' : v.toFixed(2)}</span>
        </div>
      )}
      <div
        className="relative h-2 rounded-full bg-muted"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={v}
        aria-label={label ?? 'Confidence'}
      >
        <div className={cx('h-2 rounded-full', tone)} style={{ width: `${Math.round(v * 100)}%` }} />
        <div
          className="absolute -top-1 h-4 w-0.5 bg-foreground"
          style={{ left: `${threshold * 100}%` }}
          title={`Auto-approve threshold ${threshold}`}
          aria-hidden
        />
      </div>
      {compact && (
        <span className="num mt-0.5 block font-mono text-xs">
          {value === null || value === undefined ? '—' : v.toFixed(2)}
        </span>
      )}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed border-input p-10 text-center">
      <Inbox className="h-10 w-10 text-muted-foreground" aria-hidden />
      <p className="text-lg font-semibold">{title}</p>
      {body && <p className="max-w-md text-muted-foreground">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const e = error as ApiError;
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-card border border-danger/40 bg-danger-soft p-4 text-danger"
    >
      <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold">{e?.code ?? 'Error'}</p>
        <p>{e?.message ?? String(error)}</p>
        {e?.requestId && <p className="mt-1 font-mono text-xs opacity-80">request {e.requestId}</p>}
      </div>
    </div>
  );
}

export function Hash({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <code title={value} className={cx('rounded bg-muted px-1.5 py-0.5 font-mono text-xs', className)}>
      {value.slice(0, 10)}…{value.slice(-6)}
    </code>
  );
}

export const pct = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(digits)}%`;
export const pkr = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `PKR ${new Intl.NumberFormat('en-PK').format(v)}`;

export function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-semibold text-danger">{error}</span>}
    </label>
  );
}

export const inputCls = 'min-h-[40px] w-full rounded-lg border border-input bg-card px-3 text-sm';

import type { ReactNode } from 'react';
import { ApiError } from '../shared/api/errors';

/** Small staff-console UI kit. English LTR, dense, keyboard-friendly. */

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
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-ink/10 bg-white p-4 shadow-sm ${className}`}>{children}</section>;
}

export function CardTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h2 className="text-sm font-bold text-ink">{children}</h2>
      {hint && <span className="text-[11px] text-ink-soft">{hint}</span>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="grid min-h-[30vh] place-items-center text-sm text-ink-soft">{label}</div>;
}

export function ErrorState({ error }: { error: unknown }) {
  const api = error instanceof ApiError ? error : null;
  return (
    <div role="alert" className="rounded-xl border-2 border-[#B42318]/30 bg-[#B42318]/5 p-4 text-sm">
      <p className="font-bold text-[#B42318]">{api?.code ?? 'ERROR'}</p>
      <p className="mt-1 text-ink">{api?.messageEn ?? String(error)}</p>
      {api?.requestId && <p className="mt-1 font-mono text-[11px] text-ink-soft">request {api.requestId}</p>}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-ink/20 p-6 text-center text-sm text-ink-soft">{children}</div>;
}

const BAND_STYLES: Record<string, string> = {
  URGENT: 'bg-[#B42318] text-white',
  HIGH: 'bg-amber-400 text-[#3B2A00]',
  NORMAL: 'bg-slate-200 text-slate-800',
  LOW: 'bg-slate-100 text-slate-600',
};

export function PriorityBand({ band }: { band: string }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${BAND_STYLES[band] ?? BAND_STYLES.NORMAL}`}>
      {band}
    </span>
  );
}

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'danger' | 'warn' | 'ok' | 'info' }) {
  const tones: Record<string, string> = {
    neutral: 'bg-ink/5 text-ink-soft',
    danger: 'bg-[#B42318]/10 text-[#B42318]',
    warn: 'bg-amber-100 text-amber-700',
    ok: 'bg-[#0F7B3F]/10 text-[#0F7B3F]',
    info: 'bg-[#1D4ED8]/10 text-[#1D4ED8]',
  };
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>{children}</span>;
}

export function ConfidenceBar({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[11px] text-ink-soft">—</span>;
  const pct = Math.round(value * 100);
  const tone = value >= 0.9 ? 'bg-[#0F7B3F]' : value >= 0.7 ? 'bg-amber-400' : 'bg-[#B42318]';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-ink/10">
        <span className={`block h-full ${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="num text-[11px] font-semibold text-ink-soft">{value.toFixed(2)}</span>
    </span>
  );
}

export function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-ink/10 bg-white p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{label}</p>
      <p className="num mt-1 text-2xl font-bold text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-soft">{hint}</p>}
    </div>
  );
}

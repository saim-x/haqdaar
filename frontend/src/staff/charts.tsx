import { useState } from 'react';
import { cx } from '../shared/ui/cx';

// Small dependency-free SVG charts. Every chart has a text alternative and a
// table toggle, and series are distinguished by dash pattern + label, not colour alone.

export interface Series {
  name: string;
  values: number[];
  className: string; // stroke-* token class
  dash?: string;
  format?: (v: number) => string;
  axis?: 'left' | 'right';
}

export function LineChart({
  xs,
  series,
  marker,
  markerLabel,
  height = 280,
  xLabel,
  title,
}: {
  xs: number[];
  series: Series[];
  marker?: number;
  markerLabel?: string;
  height?: number;
  xLabel: string;
  title: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 720;
  const H = height;
  const pad = { l: 48, r: 56, t: 16, b: 40 };
  const x = (v: number) => pad.l + ((v - xs[0]) / (xs[xs.length - 1] - xs[0] || 1)) * (W - pad.l - pad.r);
  const left = series.filter((s) => s.axis !== 'right');
  const right = series.filter((s) => s.axis === 'right');
  const maxOf = (ss: Series[]) => Math.max(1e-9, ...ss.flatMap((s) => s.values));
  const lMax = maxOf(left);
  const rMax = right.length ? maxOf(right) : 1;
  const y = (v: number, axis: 'left' | 'right' = 'left') => pad.t + (1 - v / (axis === 'right' ? rMax : lMax)) * (H - pad.t - pad.b);

  return (
    <figure>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <svg width="26" height="8" aria-hidden>
              <line x1="0" y1="4" x2="26" y2="4" className={s.className} strokeWidth="3" strokeDasharray={s.dash} />
            </svg>
            {s.name}
            {s.axis === 'right' && <span className="text-muted-foreground">(right axis)</span>}
          </span>
        ))}
        <button type="button" className="ms-auto rounded border border-border px-2 py-0.5 font-semibold hover:bg-muted" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {table ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-1 pe-3">{xLabel}</th>
                {series.map((s) => (
                  <th key={s.name} className="py-1 pe-3">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono">
              {xs.map((xv, i) => (
                <tr key={xv} className={cx(marker !== undefined && Math.abs(xv - marker) < 1e-6 && 'bg-primary-soft font-bold')}>
                  <td className="py-1 pe-3">{xv.toFixed(2)}</td>
                  {series.map((s) => (
                    <td key={s.name} className="py-1 pe-3">
                      {s.format ? s.format(s.values[i]) : s.values[i]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
          {[0, 0.25, 0.5, 0.75, 1].map((g) => (
            <g key={g}>
              <line x1={pad.l} x2={W - pad.r} y1={pad.t + g * (H - pad.t - pad.b)} y2={pad.t + g * (H - pad.t - pad.b)} className="stroke-border" strokeWidth="1" />
              <text x={pad.l - 6} y={pad.t + g * (H - pad.t - pad.b) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
                {left[0]?.format ? left[0].format(lMax * (1 - g)) : Math.round(lMax * (1 - g))}
              </text>
              {right.length > 0 && (
                <text x={W - pad.r + 6} y={pad.t + g * (H - pad.t - pad.b) + 4} className="fill-muted-foreground text-[11px]">
                  {right[0].format ? right[0].format(rMax * (1 - g)) : (rMax * (1 - g)).toFixed(2)}
                </text>
              )}
            </g>
          ))}
          {xs.map((xv) => (
            <text key={xv} x={x(xv)} y={H - pad.b + 18} textAnchor="middle" className="fill-muted-foreground text-[11px]">
              {xv.toFixed(2)}
            </text>
          ))}
          <text x={(W - pad.r + pad.l) / 2} y={H - 4} textAnchor="middle" className="fill-muted-foreground text-[11px] font-semibold">
            {xLabel}
          </text>
          {marker !== undefined && (
            <g>
              <rect x={x(marker) - 14} y={pad.t} width="28" height={H - pad.t - pad.b} className="fill-primary-soft" opacity="0.7" />
              <line x1={x(marker)} x2={x(marker)} y1={pad.t} y2={H - pad.b} className="stroke-primary" strokeWidth="2" />
              <text x={x(marker)} y={pad.t + 12} textAnchor="middle" className="fill-primary text-[11px] font-bold">
                {markerLabel ?? `τ = ${marker}`}
              </text>
            </g>
          )}
          {series.map((s) => (
            <g key={s.name}>
              <polyline
                fill="none"
                className={s.className}
                strokeWidth="3"
                strokeDasharray={s.dash}
                strokeLinejoin="round"
                points={s.values.map((v, i) => `${x(xs[i])},${y(v, s.axis)}`).join(' ')}
              />
              {s.values.map((v, i) => (
                <circle key={i} cx={x(xs[i])} cy={y(v, s.axis)} r={hover === i ? 5 : 3} className={cx(s.className, 'fill-card')} strokeWidth="2" />
              ))}
            </g>
          ))}
          {xs.map((xv, i) => (
            <rect key={xv} x={x(xv) - 18} y={pad.t} width="36" height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
          {hover !== null && (
            <g pointerEvents="none">
              <rect x={Math.min(x(xs[hover]) + 10, W - 210)} y={pad.t + 8} width="200" height={20 + series.length * 16} rx="6" className="fill-card stroke-input" />
              <text x={Math.min(x(xs[hover]) + 20, W - 200)} y={pad.t + 24} className="fill-foreground text-[12px] font-bold">
                {xLabel} {xs[hover].toFixed(2)}
              </text>
              {series.map((s, k) => (
                <text key={s.name} x={Math.min(x(xs[hover]) + 20, W - 200)} y={pad.t + 40 + k * 16} className="fill-foreground text-[11px]">
                  {s.name}: {s.format ? s.format(s.values[hover]) : s.values[hover]}
                </text>
              ))}
            </g>
          )}
        </svg>
      )}
    </figure>
  );
}

export function BeforeAfterBars({ categories, before, after, title }: { categories: string[]; before: number[]; after: number[]; title: string }) {
  const max = Math.max(1, ...before, ...after);
  return (
    <figure aria-label={title}>
      <div className="mb-2 flex gap-4 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-neutral" aria-hidden /> Current rule
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-primary" style={{ backgroundImage: 'repeating-linear-gradient(45deg, transparent 0 3px, rgb(255 255 255 / 0.35) 3px 5px)' }} aria-hidden /> Draft rule
        </span>
      </div>
      <div className="space-y-3">
        {categories.map((c, i) => (
          <div key={c}>
            <div className="mb-1 flex justify-between text-sm">
              <span className="font-semibold">{c}</span>
              <span className="font-mono">
                {before[i]} → <strong>{after[i]}</strong>{' '}
                <span className={cx(after[i] - before[i] > 0 ? 'text-info' : after[i] - before[i] < 0 ? 'text-warn' : 'text-muted-foreground')}>
                  ({after[i] - before[i] >= 0 ? '+' : ''}
                  {after[i] - before[i]})
                </span>
              </span>
            </div>
            <div className="space-y-1">
              <div className="h-3 rounded-sm bg-neutral" style={{ width: `${(before[i] / max) * 100}%` }} />
              <div className="h-3 rounded-sm bg-primary" style={{ width: `${(after[i] / max) * 100}%`, backgroundImage: 'repeating-linear-gradient(45deg, transparent 0 3px, rgb(255 255 255 / 0.35) 3px 5px)' }} />
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}

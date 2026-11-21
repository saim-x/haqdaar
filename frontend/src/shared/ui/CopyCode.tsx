import { useCallback, useEffect, useRef, useState } from 'react';
import { IconCheck, IconCopy } from './Icons';

type Tone = 'teal' | 'ink' | 'green' | 'amber';

interface CopyCodeProps {
  value: string;
  /** Short label shown before the code, e.g. "OTP" or "HQ code". */
  label?: string;
  tone?: Tone;
  /** `sm` for dense staff tables, `md` for standalone cards. */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * A code is a figure, not a badge. It sits in mono with tabular figures on a
 * raised surface, and the copy affordance is the icon — so the chip stays quiet
 * and the code itself is the thing you read.
 */
const TONES: Record<Tone, string> = {
  teal: 'border-accent/30 bg-accent-wash text-accent-ink hover:border-accent/60',
  ink: 'border-ink/[0.14] bg-raised text-ink hover:border-ink/30',
  green: 'border-positive/30 bg-positive-wash text-positive hover:border-positive/60',
  amber: 'border-warn/30 bg-warn-wash text-warn hover:border-warn/60',
};

/**
 * Tap-to-copy code chip — docs/11 §6.5.
 *
 * The device simulator is how a judge drives the demo, so every code it shows
 * (OTP, HQ verification code, API key) must be one tap from the clipboard with a
 * visible confirmation. Works offline — the clipboard is local — and when the
 * async Clipboard API is unavailable (insecure context, denied permission) it
 * falls back to a selection + `execCommand('copy')`, so the affordance never
 * silently does nothing.
 */
export function CopyCode({ value, label, tone = 'teal', size = 'sm', className = '' }: CopyCodeProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const flash = useCallback((next: 'copied' | 'manual') => {
    setState(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 1800);
  }, []);

  const copy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        flash('copied');
        return;
      }
    } catch {
      /* fall through to the manual path */
    }
    try {
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      flash(ok ? 'copied' : 'manual');
    } catch {
      flash('manual');
    }
  }, [flash, value]);

  const copied = state === 'copied';
  const manual = state === 'manual';

  return (
    <button
      type="button"
      onClick={() => void copy()}
      data-testid="copy-code"
      data-copied={copied ? 'true' : 'false'}
      data-code={value}
      aria-label={`Copy ${label ? `${label} ` : ''}${value}`}
      title={manual ? 'Select the code and press Ctrl+C' : 'Tap to copy'}
      className={`press inline-flex items-center gap-1.5 rounded-[6px] border font-medium ${
        size === 'md' ? 'min-h-tap px-2.5 text-caption' : 'min-h-[32px] px-2 text-meta'
      } ${copied ? 'border-positive/40 bg-positive-wash text-positive' : TONES[tone]} ${className}`}
    >
      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      {label && <span className="text-ink-3">{label}</span>}
      <span className="num font-mono">{value}</span>
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied to clipboard' : manual ? 'Copy failed — select the code and press Control C' : ''}
      </span>
    </button>
  );
}

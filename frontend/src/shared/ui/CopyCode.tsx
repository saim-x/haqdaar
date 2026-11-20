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

const TONES: Record<Tone, string> = {
  teal: 'border-teal-700 bg-teal-600 text-white hover:bg-teal-700',
  ink: 'border-ink bg-ink text-white hover:bg-ink/90',
  green: 'border-[#0F7B3F] bg-[#0F7B3F] text-white hover:bg-[#0F7B3F]/90',
  amber: 'border-amber-500 bg-amber-400 text-[#3B2A00] hover:bg-amber-300',
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
      className={`inline-flex items-center gap-1.5 rounded border font-bold transition ${
        size === 'md' ? 'min-h-tap px-2.5 text-xs' : 'min-h-[32px] px-2 text-[11px]'
      } ${copied ? 'border-[#0F7B3F] bg-[#0F7B3F] text-white' : TONES[tone]} ${className}`}
    >
      {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
      {label && <span className="font-semibold opacity-80">{label}</span>}
      <span className="num tracking-wide">{value}</span>
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied to clipboard' : manual ? 'Copy failed — select the code and press Control C' : ''}
      </span>
    </button>
  );
}

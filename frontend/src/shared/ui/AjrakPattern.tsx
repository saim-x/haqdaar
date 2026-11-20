import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * Tone-on-tone geometric pattern inspired by Sindhi ajrak block prints.
 * Pure SVG, inherits currentColor, ~1 KB. Decorative only.
 */
export function AjrakPattern({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg aria-hidden className={cn('pointer-events-none absolute inset-0 h-full w-full', className)}>
      <defs>
        <pattern id={`ajrak-${id}`} width="56" height="56" patternUnits="userSpaceOnUse">
          <rect width="56" height="56" fill="none" />
          <path d="M28 6 L34 22 L50 28 L34 34 L28 50 L22 34 L6 28 L22 22 Z" fill="currentColor" opacity="0.55" />
          <circle cx="28" cy="28" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.9" />
          <path d="M0 0 L8 0 L0 8 Z M56 0 L48 0 L56 8 Z M0 56 L8 56 L0 48 Z M56 56 L48 56 L56 48 Z" fill="currentColor" opacity="0.7" />
          <circle cx="0" cy="28" r="2" fill="currentColor" />
          <circle cx="56" cy="28" r="2" fill="currentColor" />
          <circle cx="28" cy="0" r="2" fill="currentColor" />
          <circle cx="28" cy="56" r="2" fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#ajrak-${id})`} />
    </svg>
  );
}

/** The Haqdaar mark: an H whose crossbar is a handshake line, with a saffron seal dot. */
export function HaqdaarMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('relative inline-flex items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[inset_0_-3px_0_rgb(var(--action-primary-press))]', className)}>
      <svg viewBox="0 0 24 24" className="h-[55%] w-[55%]" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
        <path d="M7 4.5v15M17 4.5v15M7 12c2.5-2 7.5-2 10 0" />
      </svg>
      <span className="absolute -bottom-0.5 -end-0.5 h-[28%] w-[28%] rounded-full border-2 border-background bg-highlight" />
    </span>
  );
}

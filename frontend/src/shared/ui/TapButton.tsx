import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Buttons.
 *
 * Quiet chrome: one accent, used only on the primary action. Secondary is a
 * raised surface with a hairline, not a 2px frame. Press feedback is a 0.97
 * scale at 120ms — 0.99 is invisible, so it reads as no feedback at all.
 *
 * Sizes keep the docs/11 §2.4 accessibility floors: `primary` is 56px tall,
 * `tap` is 48px. `sm` is for staff consoles only, where the pointer is a mouse.
 */
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
type Size = 'primary' | 'tap' | 'sm';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white border-transparent hover:bg-accent-ink',
  secondary: 'bg-card text-ink border-ink/[0.14] hover:bg-raised',
  danger: 'bg-negative text-white border-transparent hover:bg-negative-ink',
  success: 'bg-positive text-white border-transparent hover:bg-positive-ink',
  ghost: 'bg-transparent text-ink-2 border-transparent hover:bg-raised hover:text-ink',
};

/**
 * A disabled control is inert, so it looks inert whatever it would have been.
 * Fading the accent to 45 % left a pale mint block that still read as "the
 * button" — the one thing a disabled button must not do. It becomes a raised
 * surface with muted text instead, and the accent stays reserved for the action
 * that is actually available.
 */
const DISABLED: Record<Variant, string> = {
  primary: 'disabled:bg-raised disabled:text-ink-3',
  secondary: 'disabled:bg-raised disabled:text-ink-3',
  danger: 'disabled:bg-raised disabled:text-ink-3',
  success: 'disabled:bg-raised disabled:text-ink-3',
  ghost: 'disabled:bg-transparent disabled:text-ink-3',
};

const SIZES: Record<Size, string> = {
  primary: 'min-h-primary px-6 text-body-lg',
  tap: 'min-h-tap px-4 text-body',
  sm: 'min-h-[36px] px-3 text-caption',
};

interface CommonProps {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

function classes({ variant = 'primary', size = 'primary', block, className = '' }: CommonProps): string {
  return [
    'press inline-flex items-center justify-center gap-2 rounded-control border font-medium',
    'disabled:cursor-not-allowed disabled:border-transparent',
    VARIANTS[variant],
    DISABLED[variant],
    SIZES[size],
    block ? 'w-full' : '',
    className,
  ].join(' ');
}

export function TapButton({
  variant,
  size,
  block,
  icon,
  children,
  className,
  ...rest
}: CommonProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={classes({ variant, size, block, children, className })} {...rest}>
      {icon}
      <span>{children}</span>
    </button>
  );
}

export function TapLink({ to, variant, size, block, icon, children, className }: CommonProps & { to: string }) {
  return (
    <Link to={to} className={classes({ variant, size, block, children, className })}>
      {icon}
      <span>{children}</span>
    </Link>
  );
}

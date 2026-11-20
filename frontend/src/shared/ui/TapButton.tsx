import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
type Size = 'primary' | 'tap' | 'sm';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-teal-600 text-white border-teal-700 hover:bg-teal-700 active:bg-teal-800',
  secondary: 'bg-white text-ink border-ink/25 hover:bg-teal-50 active:bg-teal-100',
  danger: 'bg-[#B42318] text-white border-[#8F1B12] hover:bg-[#9A1D14] active:bg-[#7E1710]',
  success: 'bg-[#0F7B3F] text-white border-[#0B5F31] hover:bg-[#0B5F31]',
  ghost: 'bg-transparent text-ink border-transparent hover:bg-ink/5',
};

const SIZES: Record<Size, string> = {
  primary: 'min-h-primary px-6 text-lg',
  tap: 'min-h-tap px-4 text-base',
  sm: 'min-h-tap px-3 text-sm',
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
    'inline-flex items-center justify-center gap-2 rounded-2xl border-2 font-semibold',
    'transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700',
    VARIANTS[variant],
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

export function TapLink({
  to,
  variant,
  size,
  block,
  icon,
  children,
  className,
}: CommonProps & { to: string }) {
  return (
    <Link to={to} className={classes({ variant, size, block, children, className })}>
      {icon}
      <span>{children}</span>
    </Link>
  );
}

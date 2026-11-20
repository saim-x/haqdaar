import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg' | 'xl';

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-brand-ink hover:bg-brand-hover active:bg-brand-hover',
  secondary: 'bg-surface text-ink border-2 border-line-strong hover:bg-sunken active:bg-sunken',
  ghost: 'bg-transparent text-ink hover:bg-sunken active:bg-sunken',
  danger: 'bg-danger text-white hover:bg-danger-hover active:bg-danger-hover',
  success: 'bg-ok text-white hover:opacity-90',
};

// sm keeps the 24px WCAG minimum but staff-only; citizen UI uses lg/xl (>= 56px).
const sizes: Record<Size, string> = {
  sm: 'min-h-[32px] px-3 text-sm gap-1.5 rounded-lg',
  md: 'min-h-tap px-4 text-base gap-2 rounded-control',
  lg: 'min-h-tap-lg px-5 text-lg gap-2.5 rounded-control font-semibold',
  xl: 'min-h-[72px] px-6 text-xl gap-3 rounded-card font-bold',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, block, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      // Loading keeps full strength (it is "happening", not "unavailable").
      disabled={disabled}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center select-none transition-colors duration-fast ease-out',
        'disabled:opacity-50 disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="h-5 w-5" /> : icon}
      {children}
    </button>
  );
});

import { forwardRef, type ReactNode } from 'react';
import { Button as UIButton, type ButtonProps as UIButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Spinner } from './Spinner';

// App-level Button built on shadcn/ui's Button (cva variants). Keeps the app's API so
// every screen picks up the shadcn styling without touching call sites.

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg' | 'xl';

const VARIANT: Record<Variant, UIButtonProps['variant']> = {
  primary: 'default',
  secondary: 'outline',
  ghost: 'ghost',
  danger: 'destructive',
  success: 'success',
};

export interface ButtonProps extends Omit<UIButtonProps, 'variant' | 'size' | 'tactile'> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, block, className, children, ...rest },
  ref,
) {
  return (
    <UIButton
      ref={ref}
      variant={VARIANT[variant]}
      size={size}
      // Large citizen controls get the tactile press; ghost buttons stay flat.
      tactile={(size === 'lg' || size === 'xl') && variant !== 'ghost'}
      // Loading keeps full strength (it is "happening", not "unavailable").
      aria-busy={loading || undefined}
      className={cn(block && 'w-full', className)}
      {...rest}
    >
      {loading ? <Spinner className="h-5 w-5" /> : icon}
      {children}
    </UIButton>
  );
});

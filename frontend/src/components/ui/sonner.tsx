import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

/** shadcn/ui Toaster, themed with our semantic tokens (no next-themes dependency). */
const Toaster = ({ ...props }: ToasterProps) => {
  const dark = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';
  return (
    <Sonner
      theme={dark ? 'dark' : 'light'}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: 'group toast group-[.toaster]:bg-surface group-[.toaster]:text-ink group-[.toaster]:border-line group-[.toaster]:shadow-lift',
          description: 'group-[.toast]:text-muted',
          actionButton: 'group-[.toast]:bg-brand group-[.toast]:text-brand-ink',
          cancelButton: 'group-[.toast]:bg-sunken group-[.toast]:text-muted',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

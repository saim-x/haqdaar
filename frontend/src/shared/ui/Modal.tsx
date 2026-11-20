import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  closeLabel?: string;
  description?: string;
}

/** shadcn/ui Dialog (Radix): focus trap, Esc, scroll lock, focus restore, RTL-aware. */
export function Modal({ open, onClose, title, children, footer, size = 'md', description }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className={cn(
          'max-h-[88vh] w-[calc(100vw-2rem)] gap-0 overflow-hidden rounded-2xl border-line p-0',
          size === 'sm' && 'max-w-sm',
          size === 'md' && 'max-w-lg',
          size === 'lg' && 'max-w-3xl',
        )}
      >
        <DialogHeader className="border-b border-line px-5 py-4 pe-12">
          <DialogTitle className="text-lg font-bold leading-snug">{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <DialogFooter className="border-t border-line bg-sunken/50 px-5 py-3">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

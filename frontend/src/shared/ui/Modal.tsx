import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from './cx';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  closeLabel?: string;
}

/** Accessible dialog built on <dialog>: focus trap, Esc to close, focus restore. */
export function Modal({ open, onClose, title, children, footer, size = 'md', closeLabel = 'Close' }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby="modal-title"
      className={cx(
        'w-[calc(100vw-2rem)] rounded-card border border-line bg-surface p-0 text-ink shadow-lift backdrop:bg-black/50',
        size === 'sm' && 'max-w-sm',
        size === 'md' && 'max-w-lg',
        size === 'lg' && 'max-w-3xl',
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col animate-rise">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <h2 id="modal-title" className="text-lg font-semibold leading-snug">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="-m-2 inline-flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-sunken"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

import type { CaseStatus } from '../api/types';
import { useT } from '../i18n';
import { STATUS, toneClasses } from '../status';
import { cx } from './cx';

/** Pictogram + text + colour. Staff variant uses the short English label. */
export function StatusBadge({ status, variant = 'citizen', className }: { status: CaseStatus; variant?: 'citizen' | 'staff'; className?: string }) {
  const { t } = useT();
  const meta = STATUS[status] ?? STATUS.DRAFT;
  const tone = toneClasses[meta.tone];
  const Icon = meta.icon;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        tone.soft,
        tone.text,
        variant === 'staff' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm',
        className,
      )}
    >
      <Icon className={variant === 'staff' ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden />
      {variant === 'staff' ? meta.short : t(meta.label)}
    </span>
  );
}

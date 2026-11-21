import type { CaseStatus } from '../api/types';
import { useI18n } from '../i18n/I18nProvider';
import type { DictKey } from '../i18n/dictionary';
import { IconBadge, IconCheck, IconClock, IconCoin, IconCross, IconDocument, IconLock, IconQuestion } from './Icons';

/**
 * Status = icon + colour + text, never colour alone (docs/11 §2.3).
 *
 * The colour lives in a 6px dot and the icon, not in a filled pill. Six
 * saturated pills on one screen means nothing leads; a dot plus a label keeps
 * the surface quiet and still carries the meaning three ways.
 */
type Tone = 'approved' | 'needs' | 'review' | 'waiting' | 'paused' | 'rejected' | 'neutral';

interface StatusStyle {
  tone: Tone;
  Icon: typeof IconCheck;
  key: DictKey;
}

const STYLES: Record<CaseStatus, StatusStyle> = {
  DRAFT: { tone: 'neutral', Icon: IconDocument, key: 'status.DRAFT' },
  SUBMITTED: { tone: 'waiting', Icon: IconClock, key: 'status.SUBMITTED' },
  PROCESSING: { tone: 'waiting', Icon: IconClock, key: 'status.PROCESSING' },
  WAITING_EXTERNAL: { tone: 'waiting', Icon: IconClock, key: 'status.WAITING_EXTERNAL' },
  NEEDS_INFO: { tone: 'needs', Icon: IconQuestion, key: 'status.NEEDS_INFO' },
  HUMAN_REVIEW: { tone: 'review', Icon: IconBadge, key: 'status.HUMAN_REVIEW' },
  IN_REVIEW: { tone: 'review', Icon: IconBadge, key: 'status.IN_REVIEW' },
  PENDING_SECOND_APPROVAL: { tone: 'review', Icon: IconBadge, key: 'status.PENDING_SECOND_APPROVAL' },
  ON_HOLD_CONSENT: { tone: 'paused', Icon: IconLock, key: 'status.ON_HOLD_CONSENT' },
  APPROVED: { tone: 'approved', Icon: IconCoin, key: 'status.APPROVED' },
  PAYMENT_INITIATED: { tone: 'approved', Icon: IconCoin, key: 'status.PAYMENT_INITIATED' },
  PAID: { tone: 'approved', Icon: IconCheck, key: 'status.PAID' },
  PAYMENT_FAILED: { tone: 'needs', Icon: IconQuestion, key: 'status.PAYMENT_FAILED' },
  REJECTED: { tone: 'rejected', Icon: IconCross, key: 'status.REJECTED' },
  WITHDRAWN: { tone: 'neutral', Icon: IconCross, key: 'status.WITHDRAWN' },
  CLOSED: { tone: 'neutral', Icon: IconCheck, key: 'status.CLOSED' },
};

/** Dot fill and text colour per tone. Text colours all clear 4.5:1 on paper. */
const TONE: Record<Tone, { dot: string; text: string }> = {
  approved: { dot: 'bg-positive', text: 'text-positive' },
  needs: { dot: 'bg-warn', text: 'text-warn' },
  review: { dot: 'bg-info', text: 'text-info' },
  waiting: { dot: 'bg-ink-3', text: 'text-ink-2' },
  paused: { dot: 'bg-paused', text: 'text-paused' },
  rejected: { dot: 'bg-negative', text: 'text-negative' },
  neutral: { dot: 'bg-ink-3', text: 'text-ink-2' },
};

export function statusTone(status: CaseStatus): Tone {
  return STYLES[status]?.tone ?? 'neutral';
}

export function StatusBadge({ status, size = 'md' }: { status: CaseStatus; size?: 'sm' | 'md' | 'lg' }) {
  const { t } = useI18n();
  const style = STYLES[status] ?? STYLES.DRAFT;
  const { Icon } = style;
  const tone = TONE[style.tone];

  const dims =
    size === 'lg'
      ? 'gap-2.5 text-lead'
      : size === 'sm'
        ? 'gap-1.5 text-meta'
        : 'gap-2 text-caption';
  const iconSize = size === 'lg' ? 22 : size === 'sm' ? 14 : 16;

  return (
    <span className={`inline-flex items-center font-medium ${tone.text} ${dims}`}>
      <Icon size={iconSize} />
      <span>{t(style.key)}</span>
    </span>
  );
}

/** A bare dot for dense tables, where the label is already in the next column. */
export function StatusDot({ status }: { status: CaseStatus }) {
  const tone = TONE[statusTone(status)];
  return <span aria-hidden className={`live-dot ${tone.dot}`} />;
}

export function statusLabelKey(status: CaseStatus): DictKey {
  return (STYLES[status] ?? STYLES.DRAFT).key;
}

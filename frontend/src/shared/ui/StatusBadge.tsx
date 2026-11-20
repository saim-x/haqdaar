import type { CaseStatus } from '../api/types';
import { useI18n } from '../i18n/I18nProvider';
import type { DictKey } from '../i18n/dictionary';
import { IconBadge, IconCheck, IconClock, IconCoin, IconCross, IconDocument, IconLock, IconQuestion } from './Icons';

/**
 * Status = icon + colour + text, never colour alone (docs/11 §2.3).
 * Every status in docs/04 §3.3 has a citizen-facing string and a pictogram.
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

const TONE_CLASSES: Record<Tone, string> = {
  approved: 'bg-[#0F7B3F]/10 text-[#0F7B3F] border-[#0F7B3F]/30',
  needs: 'bg-amber-100 text-amber-700 border-amber-400/50',
  review: 'bg-[#1D4ED8]/10 text-[#1D4ED8] border-[#1D4ED8]/30',
  waiting: 'bg-slate-100 text-slate-700 border-slate-400/40',
  paused: 'bg-[#6D28D9]/10 text-[#6D28D9] border-[#6D28D9]/30',
  rejected: 'bg-[#B42318]/10 text-[#B42318] border-[#B42318]/30',
  neutral: 'bg-ink/5 text-ink-soft border-ink/20',
};

export function statusTone(status: CaseStatus): Tone {
  return STYLES[status]?.tone ?? 'neutral';
}

export function StatusBadge({ status, size = 'md' }: { status: CaseStatus; size?: 'sm' | 'md' | 'lg' }) {
  const { t } = useI18n();
  const style = STYLES[status] ?? STYLES.DRAFT;
  const { Icon } = style;
  const dims = size === 'lg' ? 'text-lg px-4 py-3 gap-3' : size === 'sm' ? 'text-xs px-2 py-1 gap-1.5' : 'text-sm px-3 py-2 gap-2';
  const iconSize = size === 'lg' ? 28 : size === 'sm' ? 14 : 18;
  return (
    <span className={`inline-flex items-center rounded-full border-2 font-semibold ${TONE_CLASSES[style.tone]} ${dims}`}>
      <Icon size={iconSize} />
      <span>{t(style.key)}</span>
    </span>
  );
}

export function statusLabelKey(status: CaseStatus): DictKey {
  return (STYLES[status] ?? STYLES.DRAFT).key;
}

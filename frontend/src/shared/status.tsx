import {
  BadgeCheck,
  CircleCheck,
  CircleX,
  Clock,
  CloudOff,
  Coins,
  FileText,
  Lock,
  MessageCircleQuestion,
  Send,
  ShieldAlert,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { CaseStatus } from './api/types';
import type { DictKey } from './i18n';

// Status presentation (docs/11 §2.3): colour + pictogram + words, never colour alone.
export type Tone = 'ok' | 'warn' | 'info' | 'neutral' | 'consent' | 'danger';

export interface StatusMeta {
  tone: Tone;
  icon: LucideIcon;
  label: DictKey;
  clip: string;
  /** Staff-console short label */
  short: string;
}

export const STATUS: Record<CaseStatus, StatusMeta> = {
  DRAFT: { tone: 'neutral', icon: FileText, label: 'st_DRAFT', clip: 'status_draft', short: 'Draft' },
  SUBMITTED: { tone: 'info', icon: Send, label: 'st_SUBMITTED', clip: 'status_checking', short: 'Submitted' },
  PROCESSING: { tone: 'info', icon: Clock, label: 'st_PROCESSING', clip: 'status_checking', short: 'Processing' },
  WAITING_EXTERNAL: { tone: 'neutral', icon: CloudOff, label: 'st_WAITING_EXTERNAL', clip: 'status_waiting_external', short: 'Waiting external' },
  NEEDS_INFO: { tone: 'warn', icon: MessageCircleQuestion, label: 'st_NEEDS_INFO', clip: 'status_needs_info', short: 'Needs info' },
  HUMAN_REVIEW: { tone: 'info', icon: UserCheck, label: 'st_HUMAN_REVIEW', clip: 'status_human_review', short: 'Human review' },
  IN_REVIEW: { tone: 'info', icon: UserCheck, label: 'st_IN_REVIEW', clip: 'status_in_review', short: 'In review' },
  PENDING_SECOND_APPROVAL: { tone: 'info', icon: Users, label: 'st_PENDING_SECOND_APPROVAL', clip: 'status_second_approval', short: '2nd approval' },
  ON_HOLD_CONSENT: { tone: 'consent', icon: Lock, label: 'st_ON_HOLD_CONSENT', clip: 'status_on_hold_consent', short: 'Consent hold' },
  APPROVED: { tone: 'ok', icon: CircleCheck, label: 'st_APPROVED', clip: 'status_approved', short: 'Approved' },
  PAYMENT_INITIATED: { tone: 'ok', icon: Coins, label: 'st_PAYMENT_INITIATED', clip: 'status_payment_initiated', short: 'Paying' },
  PAID: { tone: 'ok', icon: BadgeCheck, label: 'st_PAID', clip: 'status_paid', short: 'Paid' },
  PAYMENT_FAILED: { tone: 'warn', icon: ShieldAlert, label: 'st_PAYMENT_FAILED', clip: 'status_payment_failed', short: 'Payment failed' },
  REJECTED: { tone: 'danger', icon: CircleX, label: 'st_REJECTED', clip: 'status_rejected', short: 'Rejected' },
  WITHDRAWN: { tone: 'neutral', icon: CircleX, label: 'st_WITHDRAWN', clip: 'status_withdrawn', short: 'Withdrawn' },
  CLOSED: { tone: 'neutral', icon: CircleCheck, label: 'st_CLOSED', clip: 'status_closed', short: 'Closed' },
};

export const toneClasses: Record<Tone, { soft: string; text: string; solid: string; border: string }> = {
  ok: { soft: 'bg-ok-soft', text: 'text-ok', solid: 'bg-ok text-white', border: 'border-ok' },
  warn: { soft: 'bg-warn-soft', text: 'text-warn', solid: 'bg-warn text-white', border: 'border-warn' },
  info: { soft: 'bg-info-soft', text: 'text-info', solid: 'bg-info text-white', border: 'border-info' },
  neutral: { soft: 'bg-neutral-soft', text: 'text-neutral', solid: 'bg-neutral text-white', border: 'border-neutral' },
  consent: { soft: 'bg-consent-soft', text: 'text-consent', solid: 'bg-consent text-white', border: 'border-consent' },
  danger: { soft: 'bg-danger-soft', text: 'text-danger', solid: 'bg-danger text-white', border: 'border-danger' },
};

export const OPEN_STATUSES: CaseStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'PROCESSING',
  'WAITING_EXTERNAL',
  'NEEDS_INFO',
  'HUMAN_REVIEW',
  'IN_REVIEW',
  'PENDING_SECOND_APPROVAL',
  'ON_HOLD_CONSENT',
];

export const isInFlight = (s: CaseStatus) =>
  s === 'SUBMITTED' || s === 'PROCESSING' || s === 'WAITING_EXTERNAL' || s === 'APPROVED' || s === 'PAYMENT_INITIATED';

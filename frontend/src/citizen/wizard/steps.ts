import type { DocType } from '../../shared/api/types';
import type { DictKey } from '../../shared/i18n';

// Wizard step definitions (docs/11 §3.2, canonical keys from docs/04 §5).
export type StepKind = 'consent' | 'text' | 'cnic' | 'dob' | 'district' | 'counter' | 'income' | 'phone' | 'photo' | 'review';

export interface StepDef {
  id: string;
  kind: StepKind;
  question: DictKey;
  hint?: DictKey;
  /** Pre-generated Urdu clip name under /audio/ur/. */
  clip: string;
  required: boolean;
  /** Offer the "I don't know" answer (stored as null + missing_reason USER_UNKNOWN). */
  allowUnknown?: boolean;
  voice?: boolean;
  docType?: DocType;
  min?: number;
  max?: number;
  /** Only for programs that need spouse information (widow grants). */
  spouseOnly?: boolean;
}

export const ALL_STEPS: StepDef[] = [
  { id: 'consent', kind: 'consent', question: 'q_consent', clip: 'q_consent', required: true },
  { id: 'applicant_full_name', kind: 'text', question: 'q_name', clip: 'q_name', required: true, voice: true },
  { id: 'applicant_cnic', kind: 'cnic', question: 'q_cnic', hint: 'q_cnic_hint', clip: 'q_cnic', required: true, voice: true },
  { id: 'applicant_dob', kind: 'dob', question: 'q_dob', clip: 'q_dob', required: true, voice: true },
  { id: 'spouse_full_name', kind: 'text', question: 'q_spouse_name', clip: 'q_spouse_name', required: true, voice: true, spouseOnly: true },
  {
    id: 'spouse_cnic',
    kind: 'cnic',
    question: 'q_spouse_cnic',
    hint: 'q_spouse_cnic_hint',
    clip: 'q_spouse_cnic',
    required: false,
    allowUnknown: true,
    voice: true,
    spouseOnly: true,
  },
  { id: 'applicant_district', kind: 'district', question: 'q_district', clip: 'q_district', required: true, voice: true },
  { id: 'children_under_18', kind: 'counter', question: 'q_children', clip: 'q_children', required: true, voice: true, min: 0, max: 15 },
  { id: 'household_size', kind: 'counter', question: 'q_household', clip: 'q_household', required: true, min: 1, max: 30 },
  { id: 'monthly_income_pkr', kind: 'income', question: 'q_income', clip: 'q_income', required: true, voice: true },
  { id: 'payout_phone', kind: 'phone', question: 'q_payout', hint: 'q_payout_hint', clip: 'q_payout', required: true },
  { id: 'doc_CNIC_FRONT', kind: 'photo', question: 'q_cnic_photo', clip: 'q_cnic_photo', required: true, docType: 'CNIC_FRONT' },
  {
    id: 'doc_SPOUSE_DEATH_CERTIFICATE',
    kind: 'photo',
    question: 'q_death_photo',
    clip: 'q_death_photo',
    required: false,
    allowUnknown: true,
    docType: 'SPOUSE_DEATH_CERTIFICATE',
    spouseOnly: true,
  },
  { id: 'review', kind: 'review', question: 'q_review', clip: 'q_review', required: false },
];

export function stepsFor(requiredDocs: DocType[] | undefined, needsSpouse: boolean): StepDef[] {
  return ALL_STEPS.filter((s) => {
    if (s.spouseOnly && !needsSpouse) return false;
    if (s.kind === 'photo' && s.docType && requiredDocs && !requiredDocs.includes(s.docType)) return false;
    return true;
  });
}

export const DISTRICTS: { value: string; ur: string }[] = [
  { value: 'Thatta', ur: 'ٹھٹھہ' },
  { value: 'Badin', ur: 'بدین' },
  { value: 'Hyderabad', ur: 'حیدرآباد' },
  { value: 'Karachi', ur: 'کراچی' },
  { value: 'Tharparkar', ur: 'تھرپارکر' },
  { value: 'Umerkot', ur: 'عمرکوٹ' },
  { value: 'Mirpurkhas', ur: 'میرپورخاص' },
  { value: 'Sukkur', ur: 'سکھر' },
  { value: 'Larkana', ur: 'لاڑکانہ' },
  { value: 'Dadu', ur: 'دادو' },
];

/** Bands store a representative value; the household survey is the primary source and a > 30 % gap is flagged. */
export const INCOME_BANDS = [
  { value: 15000, ur: '20 ہزار سے کم', en: 'Under 20,000', clip: 'income_band_1' },
  { value: 25000, ur: '20 سے 30 ہزار', en: '20,000 – 30,000', clip: 'income_band_2' },
  { value: 35000, ur: '30 سے 40 ہزار', en: '30,000 – 40,000', clip: 'income_band_3' },
  { value: 45000, ur: '40 ہزار سے زیادہ', en: 'Over 40,000', clip: 'income_band_4' },
];

export const formatCnic = (digits: string) => {
  const d = digits.replace(/\D/g, '');
  if (d.length <= 5) return d;
  if (d.length <= 12) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12, 13)}`;
};

export const normalizePhone = (raw: string) => {
  const d = raw.replace(/\D/g, '');
  if (d.startsWith('92') && d.length === 12) return `+${d}`;
  if (d.startsWith('03') && d.length === 11) return `+92${d.slice(1)}`;
  if (d.startsWith('3') && d.length === 10) return `+92${d}`;
  return raw.trim();
};

export const isValidPkPhone = (raw: string) => /^\+923\d{9}$/.test(normalizePhone(raw));

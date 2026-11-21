/**
 * Dates, written the way the rest of the interface is written.
 *
 * Two rules, both learned from bugs:
 *
 * 1. Never hand a date to `toLocaleString()`. It returns a locale dump
 *    ("21/11/2026, 2:00:00 pm") whose width and punctuation change with the
 *    browser's ICU build, so the same screen reads differently on two phones.
 * 2. Never let a date sit loose inside a sentence. A date is a run of digits
 *    and month names, and in a right-to-left paragraph the bidi algorithm is
 *    free to reorder the pieces around it — which is how "21 Nov 2026" ends up
 *    reading as "Nov 21 2026". Every formatter here returns a single
 *    self-contained string; call sites wrap it in `<bdi>` so it stays one unit.
 *
 * Month names are spelled out rather than looked up, so Urdu and English agree
 * on the same three-letter width and the same order: day, month, year.
 */

const MONTHS: Record<'ur' | 'en', string[]> = {
  ur: [
    'جنوری',
    'فروری',
    'مارچ',
    'اپریل',
    'مئی',
    'جون',
    'جولائی',
    'اگست',
    'ستمبر',
    'اکتوبر',
    'نومبر',
    'دسمبر',
  ],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `21 Nov 2026` / `21 نومبر 2026`. */
export function dayMonth(iso: string | null | undefined, lang: 'ur' | 'en'): string {
  const date = parse(iso);
  if (!date) return '—';
  return `${date.getDate()} ${MONTHS[lang][date.getMonth()]} ${date.getFullYear()}`;
}

/** `14:05` — 24-hour, because a log is a record and needs no am/pm guesswork. */
export function clock(iso: string | null | undefined): string {
  const date = parse(iso);
  if (!date) return '—';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** `21 Nov · 14:05` / `21 نومبر · 14:05`. */
export function stamp(iso: string | null | undefined, lang: 'ur' | 'en'): string {
  const date = parse(iso);
  if (!date) return '—';
  return `${date.getDate()} ${MONTHS[lang][date.getMonth()]} · ${clock(iso)}`;
}

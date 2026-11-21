/**
 * Rupees, grouped the same way everywhere.
 *
 * `Intl.NumberFormat` is safe for numbers (unlike dates, whose *shape* varies
 * with the ICU build), but it was being constructed in three files with three
 * different option sets, so the same amount could print as `28000` on one
 * screen and `28,000` on the next.
 */
const PKR = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 });

/** `28000` → `28,000`. Anything that is not a number is passed through. */
export function pkr(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) ? PKR.format(amount) : String(value);
}

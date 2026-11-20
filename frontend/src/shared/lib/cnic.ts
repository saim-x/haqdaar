/**
 * CNIC helpers — docs/11 §3.2 step 3.
 * Display format is `XXXXX-XXXXXXX-X`; the wire format is 13 bare digits.
 * All demo CNICs start with `99900` (synthetic-data rule).
 */

export const CNIC_DIGITS = 13;

export function digitsOnly(input: string): string {
  return input.replace(/\D+/g, '').slice(0, CNIC_DIGITS);
}

/** `9990010000012` → `99900-1000001-2`. Partial input is grouped as far as it goes. */
export function formatCnic(input: string): string {
  const d = digitsOnly(input);
  if (d.length <= 5) return d;
  if (d.length <= 12) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
}

export function isCompleteCnic(input: string): boolean {
  return digitsOnly(input).length === CNIC_DIGITS;
}

/** `99900-1000001-2` → `99900-•••••••-2`. Never render a full CNIC in staff UI. */
export function maskCnic(input: string | null | undefined): string {
  if (!input) return '—';
  const d = digitsOnly(input);
  if (d.length !== CNIC_DIGITS) return formatCnic(d);
  return `${d.slice(0, 5)}-•••••••-${d.slice(12)}`;
}

/** Phone helpers — Raast payout numbers are stored as `+92XXXXXXXXXX`. */
export function digitsOnlyPhone(input: string): string {
  return input.replace(/\D+/g, '').slice(0, 11);
}

/** `3001234567` or `03001234567` → `+923001234567`. */
export function toE164Pk(input: string): string {
  const d = digitsOnlyPhone(input);
  if (d.startsWith('92')) return `+${d}`;
  if (d.startsWith('0')) return `+92${d.slice(1)}`;
  return `+92${d}`;
}

export function formatPhonePk(input: string | null | undefined): string {
  if (!input) return '—';
  const d = digitsOnlyPhone(input);
  if (d.length !== 11) return input;
  return `${d.slice(0, 4)} ${d.slice(4)}`;
}

export function isCompletePhone(input: string): boolean {
  const d = digitsOnlyPhone(input);
  return d.length === 11 && (d.startsWith('03') || d.startsWith('92'));
}

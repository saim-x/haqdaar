/**
 * Codes that arrive inside simulated SMS bodies — docs/11 §6.5.
 *
 * The mock SMS service puts the OTP in the human-readable body
 * ("Your code is 922231" / "آپ کا کوڈ 922231 ہے") and the HQ verification code
 * in its own `verification_code` field. Whoever drives the demo needs both, so
 * they are extracted once here instead of being re-parsed at each call site.
 */

/** `code is 922231`, `کوڈ 922231` — anchored on the keyword, never a bare run. */
const OTP_AFTER_KEYWORD = /(?:code|کوڈ)\D{0,16}(\d{6})(?!\d)/i;

/** A 6-digit run that is not part of a longer number. */
const BARE_SIX_DIGITS = /(?:^|\D)(\d{6})(?!\d)/g;

/** `HQ-6JMZT` — the verification code printed on official notifications. */
const HQ_CODE = /\bHQ-[A-Z0-9]{4,10}\b/;

export interface SmsCodes {
  /** The 6-digit one-time code the citizen reads out to the helper. */
  otp: string | null;
  /** The `HQ-XXXXX` verification code printed on the notification. */
  hq: string | null;
}

function join(texts: Array<string | null | undefined>): string {
  return texts.filter((t): t is string => typeof t === 'string' && t.length > 0).join('\n');
}

export function extractOtp(...texts: Array<string | null | undefined>): string | null {
  const body = join(texts);
  if (!body) return null;

  const anchored = OTP_AFTER_KEYWORD.exec(body);
  if (anchored?.[1]) return anchored[1];

  // No keyword to anchor on: accept a bare 6-digit run only when the body holds
  // exactly one, so an amount or a date can never be mistaken for a code.
  const bare = new Set(Array.from(body.matchAll(BARE_SIX_DIGITS), (m) => m[1]));
  return bare.size === 1 ? [...bare][0]! : null;
}

export function extractHqCode(...texts: Array<string | null | undefined>): string | null {
  const body = join(texts);
  if (!body) return null;
  return HQ_CODE.exec(body)?.[0] ?? null;
}

/**
 * Both codes for one simulated message. Tolerates every shape the mock service
 * has shipped: an explicit `verification_code`, an explicit `code`, or nothing
 * but the body text.
 */
export function smsCodes(message: {
  verification_code?: string | null;
  code?: string | null;
  body_en?: string | null;
  body_ur?: string | null;
  body?: string | null;
}): SmsCodes {
  const bodies = [message.body_en, message.body_ur, message.body];
  const explicit = (message.verification_code ?? message.code ?? '').trim() || null;
  const explicitIsHq = explicit !== null && HQ_CODE.test(explicit);

  const otp =
    extractOtp(...bodies) ??
    (explicit !== null && !explicitIsHq && /^\d{6}$/.test(explicit) ? explicit : null);

  return { otp, hq: explicitIsHq ? explicit : extractHqCode(...bodies) };
}

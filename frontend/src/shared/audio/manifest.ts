/**
 * Urdu audio manifest — `frontend/public/audio/ur/manifest.json` is owned by DPI (A4).
 * We only ever read it.
 *
 * Two shapes are accepted, because ADR-018 pins a flat `{ "<key>": "<urdu text>" }`
 * map while the artifact currently in the repo is DPI's envelope
 * (`{ voice, language, count, keys: {...}, files: {...} }`). Normalising here
 * means the UI works with either and nobody has to re-touch call sites.
 *
 * A missing manifest or a missing key is a normal condition, not an error:
 * every caller degrades to silence and the tap/keypad path still works
 * (docs/11 §2.5 — voice is an accelerator, never a single point of failure).
 */

export type AudioManifest = Record<string, string>;

/**
 * Semantic call-site key → canonical registry key (ADR-018).
 * `resolveAudioKey` tries the call-site key first, so when DPI retargets the
 * registry to FE's names the aliases simply stop being needed.
 */
const ALIASES: Record<string, string> = {
  wizard_consent: 'consent_intro',
  wizard_applicant_full_name: 'step_full_name',
  wizard_applicant_cnic: 'step_cnic',
  wizard_applicant_dob: 'step_dob',
  wizard_spouse_full_name: 'step_spouse_name',
  wizard_spouse_cnic: 'step_spouse_cnic',
  wizard_applicant_district: 'step_district',
  wizard_children_under_18: 'step_children',
  wizard_household_size: 'step_household_size',
  wizard_monthly_income_pkr: 'step_income',
  wizard_payout_phone: 'step_payout_phone',
  wizard_cnic_doc: 'step_doc_cnic',
  wizard_death_cert_doc: 'step_doc_death_cert',
  wizard_review: 'step_review',
  wizard_submitted: 'submit_confirm',
  wizard_queued: 'offline_saved',
  doc_verified: 'doc_verified',
  doc_retake: 'retake_blurry',
  doc_unverifiable: 'doc_unverifiable',
  readback_confirm: 'readback_confirm',
  needs_retry: 'needs_retry',
  unknown_ok: 'unknown_ok',
};

let cache: AudioManifest | null = null;
let inflight: Promise<AudioManifest> | null = null;

export function audioUrl(key: string): string {
  return `/audio/ur/${key}.mp3`;
}

function normalise(json: unknown): AudioManifest {
  if (!json || typeof json !== 'object') return {};
  const record = json as Record<string, unknown>;
  const out: AudioManifest = {};

  // Envelope shape: { keys: { "<key>": "<text>" } }
  const nested = record.keys;
  if (nested && typeof nested === 'object') {
    for (const [key, value] of Object.entries(nested as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
    }
  }

  // Flat shape: { "<key>": "<text>" } — skip metadata fields.
  for (const [key, value] of Object.entries(record)) {
    if (key === 'keys' || key === 'files' || key === '_meta') continue;
    if (typeof value === 'string' && key !== 'voice' && key !== 'voice_alt' && key !== 'language') {
      out[key] = value;
    }
  }

  return out;
}

export async function loadManifest(): Promise<AudioManifest> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch('/audio/ur/manifest.json', { cache: 'no-cache' });
      if (!res.ok) return {};
      const json = (await res.json()) as unknown;
      cache = normalise(json);
      return cache;
    } catch {
      return {};
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** The key that actually exists in the manifest, or the original when none does. */
export function resolveAudioKey(key: string): string {
  if (!cache) return key;
  if (key in cache) return key;
  const alias = ALIASES[key];
  if (alias && alias in cache) return alias;
  return key;
}

export function manifestText(key: string): string | null {
  if (!cache) return null;
  return cache[resolveAudioKey(key)] ?? null;
}

/**
 * Urdu audio manifest — `frontend/public/audio/ur/manifest.json` is owned by DPI (A4).
 * Shape: `{ "<key>": "<urdu text>" }`. We only ever read it.
 *
 * A missing manifest or a missing key is a normal condition, not an error:
 * every caller degrades to silence and the tap/keypad path still works
 * (docs/11 §2.5 — voice is an accelerator, never a single point of failure).
 */

export type AudioManifest = Record<string, string>;

let cache: AudioManifest | null = null;
let inflight: Promise<AudioManifest> | null = null;

export function audioUrl(key: string): string {
  return `/audio/ur/${key}.mp3`;
}

export async function loadManifest(): Promise<AudioManifest> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch('/audio/ur/manifest.json', { cache: 'force-cache' });
      if (!res.ok) return {};
      const json = (await res.json()) as unknown;
      if (!json || typeof json !== 'object') return {};
      const out: AudioManifest = {};
      for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
        if (typeof value === 'string') out[key] = value;
      }
      cache = out;
      return out;
    } catch {
      return {};
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Synchronous best-effort check once the manifest has loaded. */
export function hasAudio(key: string): boolean {
  return cache !== null && key in cache;
}

export function manifestText(key: string): string | null {
  return cache?.[key] ?? null;
}

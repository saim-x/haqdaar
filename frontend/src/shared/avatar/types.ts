/**
 * Shared types for the interactive Urdu video guide - ADR-025.
 *
 * The guide is a mouth, not a mind: it renders a face and lip-syncs audio this
 * system already produced. Nothing in this file describes a decision, because
 * the guide never makes one.
 */

/** Who renders the face. `fake` is the local simulator and costs nothing. */
export type AvatarProvider = 'anam' | 'fake';

/**
 * `conversational` gives the vendor ears and a voice: the citizen speaks Urdu and
 * Saima answers live. `passthrough` streams our own Urdu PCM into a mouth-only
 * avatar. `talk` is the single-turn fallback.
 */
export type AvatarMode = 'conversational' | 'passthrough' | 'talk';

/** The four citizen screens allowed to open a guide session. */
export type AvatarSurface = 'ask' | 'case_status' | 'wizard' | 'scam_check';

/**
 * `degraded` is a first-class state, not an error: the video is unavailable and
 * the audio-only companion has taken over. It must never look like a failure.
 */
export type AvatarState = 'idle' | 'connecting' | 'ready' | 'speaking' | 'error' | 'degraded';

/**
 * The mood drives the halo colour and nothing else. `not_sure` and `warning` are
 * the two that carry meaning: an honest abstention and an anti-scam alert.
 */
export type AvatarMood =
  | 'calm'
  | 'listening'
  | 'thinking'
  | 'happy'
  | 'reassuring'
  | 'warning'
  | 'not_sure';

/** `GET /api/v1/avatar/config` - safe, key-free, cached for five minutes. */
export interface AvatarConfig {
  enabled: boolean;
  provider: AvatarProvider;
  mode: AvatarMode;
  /** True when the stage should offer the microphone. */
  conversational: boolean;
  avatar_id: string;
  sample_rate: number;
  max_session_seconds: number;
  idle_timeout_seconds: number;
  persona_name_ur: string;
  persona_name_en: string;
}

/**
 * `POST /api/v1/avatar/session`. The degraded shape (`available: false`) is a
 * `200`, so the client branches on `available` rather than on a status code.
 */
export interface AvatarSessionResponse {
  available: boolean;
  provider?: AvatarProvider;
  mode?: AvatarMode;
  conversational?: boolean;
  session_token?: string;
  avatar_id?: string;
  sample_rate?: number;
  max_session_seconds?: number;
  idle_timeout_seconds?: number;
  simulated?: boolean;
  fallback?: 'AUDIO_ONLY';
  reason?: string;
  message_ur?: string;

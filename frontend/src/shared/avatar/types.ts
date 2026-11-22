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

/** The citizen screens allowed to open a guide session (ADR-025, Amendment 2). */
export type AvatarSurface = 'ask' | 'case_status' | 'wizard' | 'scam_check' | 'home';

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
  message_en?: string;
}

/** One live turn of the conversation, as the vendor reported it. */
export interface AvatarTurn {
  role: 'user' | 'persona';
  content: string;
}

/** A one-tap navigation chip. The guide suggests; the citizen taps. */
export interface GuideAction {
  id: 'apply' | 'cases' | 'consent' | 'scam_check' | 'my_data';
  route: string;
  label_ur: string;
  label_en: string;
  label_sd: string;
  icon: 'document' | 'list' | 'shield' | 'warning' | 'user';
}

/** One thing for the guide to say. */
export interface SpeakRequest {
  text: string;
  mood: AvatarMood;
  /** What the caption bar shows. Defaults to `text`. */
  caption?: string;
  /** A grounded citation chip, e.g. `Sahara Widow Grant Policy · 3. Documents`. */
  citation?: string;
  /** Renders the amber abstention chip instead of a citation. */
  notSure?: boolean;
  /** A pre-cached clip key; when present the clip is preferred over TTS. */
  clipKey?: string;
}

/** The controller a page holds. `speak` is a no-op while the guide is closed. */
export interface AvatarGuide {
  config: AvatarConfig | null;
  /** Which citizen screen opened the guide; sent to `POST /avatar/session`. */
  surface: AvatarSurface;
  active: boolean;
  /** True when Lite Mode or an offline browser has stepped the guide down. */
  steppedDown: boolean;
  /** True when the guide can be offered at all. */
  available: boolean;
  /** True when the guide is in two-way voice mode and can take a microphone. */
  conversational: boolean;
  microphoneAllowed: boolean;
  start(microphoneAllowed?: boolean): void;
  stop(): void;
  speak(request: SpeakRequest): void;
  /**
   * Send the citizen's own words to the guide. In `conversational` mode this is
   * what makes her answer out loud; in every other mode it is a no-op and the
   * page's own `/rag/ask` answer is the whole reply.
   */
  sendUserMessage(text: string): void;
  /**
   * Set the citation / abstention chips without speaking. Needed in
   * `conversational` mode, where the vendor owns the voice and the grounded
   * `/rag/ask` result arrives on a separate channel.
   */
  setEvidence(evidence: { citation?: string | null; notSure?: boolean }): void;
  /** Registered by the stage so the page can speak without importing it. */
  _register(handler: ((request: SpeakRequest) => void) | null): void;
  /** Registered by the stage so the page can send text without importing it. */
  _registerSend(handler: ((text: string) => void) | null): void;
  /** Registered by the stage so the page can set the chips without importing it. */
  _registerEvidence(
    handler: ((evidence: { citation?: string | null; notSure?: boolean }) => void) | null,
  ): void;
  /** Registered by the page to receive every live turn the vendor reports. */
  _registerTurn(listener: ((turn: AvatarTurn) => void) | null): void;
  /** Called by the stage to fan a live turn out to the page's listener. */
  _emitTurn(turn: AvatarTurn): void;
}

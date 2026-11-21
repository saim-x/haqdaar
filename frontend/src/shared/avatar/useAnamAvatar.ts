/**
 * The video guide engine - ADR-025.
 *
 * Three modes, one interface:
 *
 *  - `conversational` (live): the vendor listens to the citizen's own Urdu over
 *    WebRTC and answers in its own voice. This is the mode that gives a
 *    low-literacy citizen a real conversation, and the only one that needs no
 *    Deepgram or OpenAI key of ours. The vendor is grounded by a system prompt
 *    the backend builds from the live active rule version.
 *  - `passthrough` (live): the avatar is a mouth only. We stream our own Urdu
 *    audio into it as 24 kHz `pcm_s16le`; the vendor never receives a question,
 *    a case, or a CNIC.
 *  - `fake` (dev/CI/E2E): an animated local guide plus real `<audio>` playback
 *    of the same clips. Zero vendor minutes, identical citizen flow.
 *
 * `degraded` is a fourth state, not an error: the vendor refused or timed out and
 * the stage became an audio-only companion. It keeps working.
 *
 * Credit discipline is enforced here, not in the UI:
 *  - nothing connects until `connect()` is called from a tap;
 *  - 90 s of silence disconnects;
 *  - a 165 s hard cap disconnects, with a 25 s warning and a one-tap renew;
 *  - unmount, route change and a hidden tab all disconnect.
 *
 * The SDK is imported dynamically inside `connect()`. A citizen who never taps
 * the guide never downloads it, which is what keeps the entry bundle inside the
 * 150 KB budget.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentAudioInputStream, AnamClient } from '@anam-ai/js-sdk';
import { useAudio } from '../audio/AudioProvider';
import { audioUrl } from '../audio/manifest';
import { getAccessToken } from '../auth/session';
import { api } from '../api/client';
import { decodeToPcm24kMono, fetchPcm, splitForTts, streamPcmToAnam } from './pcmBridge';
import type {
  AvatarConfig,
  AvatarMode,
  AvatarMood,
  AvatarProvider,
  AvatarSessionResponse,
  AvatarState,
  AvatarSurface,
  AvatarTurn,
  SpeakRequest,
} from './types';

/** Shown for this long before the hard cap so the citizen can renew calmly. */
const RENEW_WARNING_SECONDS = 25;

/**
 * How many words of the vendor's streamed sentence stay on screen at once.
 *
 * The vendor emits one token per event. Rendering each token on its own makes
 * the caption flicker a word at a time, which is hard to read at speed and
 * re-renders the stage on every token. A short rolling window keeps three or
 * four words stable while the next one arrives, so the eye has something to
 * track - and the full sentence still lands when the turn completes.
 */
const CAPTION_WINDOW_WORDS = 4;

/** The last `count` words of `text`, collapsed to single spaces. */
function tailWords(text: string, count: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  return words.length <= count ? words.join(' ') : words.slice(-count).join(' ');
}

/**
 * The phrases Saima uses when she is declining to answer. Detecting them lets the
 * stage show the amber abstention shield for a spoken reply, exactly as it does
 * for a `/rag/ask` `NOT_SURE` - the citizen sees the same honest signal whether
 * she asked by voice or by text.
 */
const NOT_SURE_MARKERS = ['یقین نہیں', 'معلومات نہیں', 'پتہ نہیں', 'not sure', "don't know"];

function looksUnsure(text: string): boolean {
  const lowered = text.toLowerCase();
  return NOT_SURE_MARKERS.some((marker) => lowered.includes(marker.toLowerCase()));
}

/** Fallback pacing when no audio element reports a duration. */
function estimateSpeechMs(text: string): number {
  return Math.min(9000, Math.max(1200, text.length * 55));
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export interface AnamAvatarController {
  state: AvatarState;
  mood: AvatarMood;
  caption: string;
  citation: string | null;
  notSure: boolean;
  muted: boolean;
  secondsLeft: number;
  /** True inside the renew window; the stage shows the Renew button. */
  warning: boolean;
  provider: AvatarProvider;
  mode: AvatarMode;
  /** True when the stage should offer the microphone. */
  conversational: boolean;
  simulated: boolean;
  videoId: string;
  /** Set only in `degraded`; the stage renders it as the audio-only notice. */
  degradedMessage: string | null;
  /** The citizen's microphone is off. Only meaningful in `conversational`. */
  micMuted: boolean;
  /** The browser refused the microphone; the stage shows the bilingual notice. */
  micDenied: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  renew(): Promise<void>;
  interrupt(): void;
  toggleMute(): void;
  toggleMic(): void;
  speak(request: SpeakRequest): void;
  /**
   * Drive the two evidence chips without speaking. In `conversational` mode the
   * vendor owns the voice, so the page's grounded `/rag/ask` result has to reach
   * the stage some other way - this is that way.
   */
  setEvidence(evidence: { citation?: string | null; notSure?: boolean }): void;
  /** Send the citizen's own words to the guide (conversational mode). */
  sendTextToAvatar(text: string): void;
  /** Subscribe to every live turn the vendor reports. Returns an unsubscribe. */
  onTurn(listener: ((turn: AvatarTurn) => void) | null): void;
}


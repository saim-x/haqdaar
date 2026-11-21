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

export function useAnamAvatar(
  config: AvatarConfig | null,
  surface: AvatarSurface,
): AnamAvatarController {
  const { stop: stopAudio } = useAudio();
  const [state, setState] = useState<AvatarState>('idle');
  const [mood, setMood] = useState<AvatarMood>('calm');
  const [caption, setCaption] = useState('');
  const [citation, setCitation] = useState<string | null>(null);
  const [notSure, setNotSure] = useState(false);
  const [muted, setMuted] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [mode, setMode] = useState<AvatarMode>(config?.mode ?? 'passthrough');
  const [secondsLeft, setSecondsLeft] = useState(config?.max_session_seconds ?? 165);
  const [degradedMessage, setDegradedMessage] = useState<string | null>(null);

  const clientRef = useRef<AnamClient | null>(null);
  const streamRef = useRef<AgentAudioInputStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const elementRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const startedAtRef = useRef<number>(0);
  const lastActivityRef = useRef<number>(0);
  const mountedRef = useRef(true);
  const mutedRef = useRef(false);
  const speakingRef = useRef(false);
  /** True once the peer is streaming. Read synchronously, so it is a ref. */
  const connectedRef = useRef(false);
  /**
   * A page can ask the guide to speak the instant `active` flips true, which is
   * before WebRTC has finished connecting. Dropping that request loses the
   * greeting - the first thing a citizen hears - so it is held here and flushed
   * the moment the peer is ready.
   */
  const queuedSpeakRef = useRef<SpeakRequest | null>(null);
  const speakRef = useRef<(request: SpeakRequest) => void>(() => undefined);
  const turnRef = useRef<((turn: AvatarTurn) => void) | null>(null);
  const seenMessageIds = useRef<Set<string>>(new Set());
  /**
   * The persona's sentence so far, as the vendor streams it. The caption shows
   * only its tail, so the whole sentence has to be kept to know what the tail is.
   */
  const captionBufferRef = useRef('');

  const provider: AvatarProvider = config?.provider ?? 'fake';
  const simulated = provider === 'fake';
  const conversational = mode === 'conversational';
  const maxSeconds = config?.max_session_seconds ?? 165;
  const idleSeconds = config?.idle_timeout_seconds ?? 90;
  const videoId = `saima-avatar-${surface}`;

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Stop every local sound source and release its object URL. */
  const stopLocalAudio = useCallback(() => {
    const el = elementRef.current;
    if (el) {
      el.onended = el.onerror = null;
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
  }, []);

  const teardown = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    speakingRef.current = false;
    connectedRef.current = false;
    queuedSpeakRef.current = null;
    seenMessageIds.current.clear();
    captionBufferRef.current = '';
    stopLocalAudio();
    const client = clientRef.current;
    clientRef.current = null;
    streamRef.current = null;
    if (client) {
      try {
        await client.stopStreaming();
      } catch {
        // A peer that is already gone is the desired end state.
      }
    }
  }, [stopLocalAudio]);

  const disconnect = useCallback(async () => {
    await teardown();
    if (!mountedRef.current) return;
    setState('idle');
    setCaption('');
    setCitation(null);
    setNotSure(false);
    setMood('calm');
    setSecondsLeft(maxSeconds);
  }, [teardown, maxSeconds]);

  /** Play a URL through a private <audio>; false when the browser refuses. */
  const playUrl = useCallback(async (url: string, signal: AbortSignal): Promise<boolean> => {
    if (mutedRef.current) return false;
    try {
      const response = await fetch(url, { signal });
      if (!response.ok) return false;
      const blob = await response.blob();
      if (signal.aborted || blob.size === 0) return false;
      const objectUrl = URL.createObjectURL(blob);
      const el = elementRef.current ?? new Audio();
      elementRef.current = el;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = objectUrl;
      el.src = objectUrl;
      await el.play();
      return true;
    } catch {
      return false;
    }
  }, []);

  /** Ask `/voice/tts` for a clip; the fake provider returns silence, so skip it. */
  const playTts = useCallback(
    async (text: string, signal: AbortSignal): Promise<boolean> => {
      if (mutedRef.current) return false;
      const token = getAccessToken();
      if (!token || !navigator.onLine) return false;
      try {
        const response = await fetch('/api/v1/voice/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ text, lang: 'ur' }),
          signal,
        });
        if (!response.ok) return false;
        const type = response.headers.get('Content-Type') ?? '';
        if (type.includes('application/json')) {
          const payload = (await response.json()) as { audio_url?: string; url?: string };
          const url = payload.audio_url ?? payload.url;
          return url ? await playUrl(url, signal) : false;
        }
        // A silent WAV means "no real voice here"; the caption timer takes over.
        if (type.includes('audio/wav')) return false;
        const blob = await response.blob();
        if (signal.aborted || blob.size === 0) return false;
        const objectUrl = URL.createObjectURL(blob);
        const el = elementRef.current ?? new Audio();
        elementRef.current = el;
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = objectUrl;
        el.src = objectUrl;
        await el.play();
        return true;
      } catch {
        return false;
      }
    },
    [playUrl],
  );

  const speakBrowser = useCallback((text: string): boolean => {
    if (mutedRef.current) return false;
    if (typeof window === 'undefined' || !window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      return false;
    }
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = /[\u0600-\u06ff]/.test(text) ? 'ur-PK' : 'en-US';
      window.speechSynthesis.speak(utterance);
      return true;
    } catch {
      return false;
    }
  }, []);

  /** `POST /voice/tts` -> PCM. Returns null for the fake provider's silent WAV. */
  const fetchTtsPcm = useCallback(
    async (text: string, signal: AbortSignal): Promise<Int16Array | null> => {
      const token = getAccessToken();
      if (!token || !navigator.onLine) return null;
      try {
        const response = await fetch('/api/v1/voice/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ text, lang: 'ur' }),
          signal,
        });
        if (!response.ok) return null;
        const type = response.headers.get('Content-Type') ?? '';
        if (type.includes('application/json')) {
          const payload = (await response.json()) as { audio_url?: string; url?: string };
          const url = payload.audio_url ?? payload.url;
          if (!url) return null;
          const remote = await fetch(url, { signal });
          if (!remote.ok) return null;
          return await decodeToPcm24kMono(await remote.arrayBuffer());
        }
        // A silent WAV means the fake provider has no real voice; skip it.
        if (type.includes('audio/wav')) return null;
        const buffer = await response.arrayBuffer();
        if (signal.aborted || buffer.byteLength === 0) return null;
        return await decodeToPcm24kMono(buffer);
      } catch {
        return null;
      }
    },
    [],
  );

  /**
   * Speak without the vendor: clip first, then TTS, then the browser voice, then
   * a caption timer. The last step is what makes headless CI deterministic - the
   * citizen still sees the sentence, timed as if it were being read.
   */
  const speakLocally = useCallback(
    async (request: SpeakRequest, signal: AbortSignal): Promise<void> => {
      if (request.clipKey && (await playUrl(audioUrl(request.clipKey), signal))) return;
      if (signal.aborted) return;
      if (await playTts(request.text, signal)) return;
      if (signal.aborted) return;
      if (speakBrowser(request.text)) return;
      await wait(estimateSpeechMs(request.text), signal);
    },
    [playUrl, playTts, speakBrowser],
  );

  /**
   * Speak through the vendor.
   *
   * `conversational` uses `talk()`: the vendor owns the voice in that mode, and
   * its audio-passthrough stream is not open, so PCM would have nowhere to go.
   *
   * `passthrough` streams our own PCM. When no PCM can be produced it falls back
   * to the *local* voice, never to `talk()` - a passthrough session has no
   * `voiceId`, so `talk()` fails there, and a silent guide is worse than a local
   * one.
   */
  const speakLive = useCallback(
    async (request: SpeakRequest, signal: AbortSignal): Promise<void> => {
      const client = clientRef.current;
      if (!client) {
        await speakLocally(request, signal);
        return;
      }
      if (conversational) {
        try {
          await client.talk(request.text);
        } catch {
          // The caption is already on screen; a failed utterance is not an error
          // the citizen needs to see.
        }
        return;
      }
      const stream = streamRef.current;
      if (!stream) {
        await speakLocally(request, signal);
        return;
      }
      if (request.clipKey) {
        const pcm = await fetchPcm(audioUrl(request.clipKey), signal);
        if (pcm) {
          await streamPcmToAnam(stream, pcm, signal);
          return;
        }
        await speakLocally(request, signal);
        return;
      }
      for (const piece of splitForTts(request.text)) {
        if (signal.aborted) return;
        const pcm = await fetchTtsPcm(piece, signal);
        if (pcm) {
          await streamPcmToAnam(stream, pcm, signal);
          continue;
        }
        // No PCM: use the local voice. Never `talk()` - see the docstring.
        await speakLocally({ ...request, text: piece, clipKey: undefined }, signal);
      }
    },
    [conversational, fetchTtsPcm, speakLocally],
  );

  const speak = useCallback(
    (request: SpeakRequest) => {
      if (!mountedRef.current) return;
      const text = (request.caption ?? request.text ?? '').trim();
      captionBufferRef.current = '';
      setCaption(text);
      setCitation(request.citation ?? null);
      setNotSure(request.notSure === true);
      setMood(request.mood);
      lastActivityRef.current = Date.now();

      // Two voices at once is the one thing that makes this feel broken.
      stopAudio();

      // Not connected yet: hold it. `connect()` flushes this the moment the peer
      // is streaming, so the greeting is never lost to a chunk download.
      if (provider === 'anam' && !connectedRef.current) {
        queuedSpeakRef.current = request;
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      speakingRef.current = true;
      setState((prev) => (prev === 'idle' || prev === 'connecting' ? prev : 'speaking'));

      const run = provider === 'anam' && state !== 'degraded' ? speakLive : speakLocally;
      void run(request, controller.signal)
        .catch(() => undefined)
        .finally(() => {
          if (controller.signal.aborted || !mountedRef.current) return;
          speakingRef.current = false;
          // In two-way mode `talk()` resolves when the sentence is *sent*, not
          // when it is finished, so the vendor's own events decide when she has
          // stopped. Guessing here would disable Interrupt mid-sentence.
          if (!conversational) setState((prev) => (prev === 'speaking' ? 'ready' : prev));
        });
    },
    [stopAudio, provider, state, conversational, speakLive, speakLocally],
  );

  speakRef.current = speak;

  /** Send the citizen's own words to the guide. */
  const onTurn = useCallback((listener: ((turn: AvatarTurn) => void) | null) => {
    turnRef.current = listener;
  }, []);

  const sendTextToAvatar = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !mountedRef.current) return;
    lastActivityRef.current = Date.now();
    captionBufferRef.current = '';
    setCaption(trimmed);
    setMood('thinking');
    const client = clientRef.current;
    if (!client || !connectedRef.current) return;
    try {
      client.sendUserMessage(trimmed);
    } catch {
      // Not streaming: the page's own `/rag/ask` answer is still on screen.
    }
  }, []);

  const connect = useCallback(async () => {
    if (!config || state === 'connecting') return;
    setState('connecting');
    setDegradedMessage(null);
    setMicDenied(false);
    stopAudio();

    let session: AvatarSessionResponse;
    try {
      session = await api.post<AvatarSessionResponse>('/avatar/session', { surface, lang: 'ur' });
    } catch {
      if (!mountedRef.current) return;
      setState('degraded');
      setDegradedMessage(null);
      return;
    }
    if (!mountedRef.current) return;

    if (!session?.available) {
      // The vendor is down, out of quota, or disabled. Keep the guide usable.
      setState('degraded');
      setDegradedMessage(session?.message_ur ?? null);
      startedAtRef.current = Date.now();
      lastActivityRef.current = Date.now();
      return;
    }

    startedAtRef.current = Date.now();
    lastActivityRef.current = Date.now();
    setSecondsLeft(session.max_session_seconds ?? maxSeconds);
    const sessionMode: AvatarMode = session.mode ?? config.mode ?? 'passthrough';
    setMode(sessionMode);

    if (session.provider === 'fake' || !session.session_token) {
      // The simulator has no peer, but it is "connected" for the purposes of the
      // speak queue: local audio is available immediately.
      connectedRef.current = true;
      setState('ready');
      const queued = queuedSpeakRef.current;
      queuedSpeakRef.current = null;
      if (queued) speakRef.current(queued);
      return;
    }

    try {
      const mod = await import('@anam-ai/js-sdk');
      if (!mountedRef.current) return;
      const wantsMic = sessionMode === 'conversational';
      const client = mod.createClient(session.session_token, {
        // Conversational mode is the only one where the vendor gets a microphone:
        // it needs ears to hold a conversation. Every other mode is mouth-only.
        disableInputAudio: !wantsMic,
        // No client metrics: this is a prototype handling synthetic citizens and
        // we do not want a third party holding even anonymous usage traces.
        metrics: { disableClientMetrics: true },
      });
      clientRef.current = client;

      client.addListener(mod.AnamEvent.SESSION_READY, () => {
        if (mountedRef.current) setState((prev) => (prev === 'connecting' ? 'ready' : prev));
      });
      client.addListener(mod.AnamEvent.CONNECTION_CLOSED, () => {
        if (!mountedRef.current) return;
        clientRef.current = null;
        streamRef.current = null;
        connectedRef.current = false;
        setState('degraded');
      });
      client.addListener(mod.AnamEvent.MIC_PERMISSION_DENIED, () => {
        if (mountedRef.current) setMicDenied(true);
      });
      client.addListener(mod.AnamEvent.MIC_PERMISSION_GRANTED, () => {
        if (mountedRef.current) setMicDenied(false);
      });
      client.addListener(mod.AnamEvent.USER_SPEECH_STARTED, () => {
        if (!mountedRef.current) return;
        lastActivityRef.current = Date.now();
        setMood('listening');
      });
      client.addListener(mod.AnamEvent.USER_SPEECH_ENDED, () => {
        if (!mountedRef.current) return;
        lastActivityRef.current = Date.now();
        // A new answer is about to stream: start its caption from a clean buffer
        // so the previous sentence's tail cannot bleed into this one.
        captionBufferRef.current = '';
        setMood('thinking');
      });
      // Live captions: the vendor streams the persona's sentence one token at a
      // time. Accumulate it and show only the tail, so the caption reads as a
      // short line of text instead of a single word flickering in place.
      client.addListener(mod.AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, (event) => {
        if (!mountedRef.current) return;
        const text = (event.content ?? '').trim();
        if (!text) return;
        lastActivityRef.current = Date.now();
        if (event.role !== 'persona') return;
        captionBufferRef.current = `${captionBufferRef.current} ${text}`
          .replace(/\s+/g, ' ')
          .trim();
        // The abstention shield is judged on the whole sentence: one token like
        // "نہیں" is not evidence of an abstention on its own.
        const unsure = looksUnsure(captionBufferRef.current);
        setCaption(tailWords(captionBufferRef.current, CAPTION_WINDOW_WORDS));
        setMood(unsure ? 'not_sure' : 'happy');
        setNotSure(unsure);
        setState('speaking');
      });
      // The transcript: every completed turn, in order, for the page's log.
      client.addListener(mod.AnamEvent.MESSAGE_HISTORY_UPDATED, (messages) => {
        if (!mountedRef.current) return;
        lastActivityRef.current = Date.now();
        for (const message of messages) {
          if (!message?.id || seenMessageIds.current.has(message.id)) continue;
          seenMessageIds.current.add(message.id);
          const content = (message.content ?? '').trim();
          if (!content) continue;
          const role = message.role === 'persona' ? 'persona' : 'user';
          turnRef.current?.({ role, content });
          if (role === 'persona') {
            // The turn is complete, so the caption can show the whole sentence
            // rather than the streamed tail - and the buffer starts clean for
            // whatever she says next.
            captionBufferRef.current = '';
            setCaption(content);
            setNotSure(looksUnsure(content));
            setMood(looksUnsure(content) ? 'not_sure' : 'happy');
            setState((prev) => (prev === 'speaking' ? 'ready' : prev));
          }
        }
      });

      await client.streamToVideoElement(videoId);
      if (!mountedRef.current) {
        await client.stopStreaming().catch(() => undefined);
        return;
      }
      // The tap that opened the guide is the gesture that unlocks audio, so the
      // element must not stay muted or Saima's voice is never heard.
      const video = document.getElementById(videoId) as HTMLVideoElement | null;
      if (video) {
        video.muted = mutedRef.current;
        void video.play().catch(() => undefined);
      }
      if (sessionMode !== 'conversational') {
        streamRef.current = client.createAgentAudioInputStream({
          encoding: 'pcm_s16le',
          sampleRate: session.sample_rate ?? 24000,
          channels: 1,
        });
      }
      connectedRef.current = true;
      setState('ready');
      const queued = queuedSpeakRef.current;
      queuedSpeakRef.current = null;
      if (queued) speakRef.current(queued);
    } catch {
      if (!mountedRef.current) return;
      await teardown();
      setState('degraded');
    }
  }, [stopAudio, config, maxSeconds, state, surface, teardown, videoId]);

  const renew = useCallback(async () => {
    await teardown();
    if (!mountedRef.current) return;
    setState('idle');
    setSecondsLeft(maxSeconds);
    await connect();
  }, [connect, maxSeconds, teardown]);

  const interrupt = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    speakingRef.current = false;
    stopLocalAudio();
    try {
      clientRef.current?.interruptPersona();
    } catch {
      /* nothing to interrupt */
    }
    setState((prev) => (prev === 'speaking' ? 'ready' : prev));
  }, [stopLocalAudio]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      if (next) {
        stopLocalAudio();
        try {
          clientRef.current?.interruptPersona();
        } catch {
          /* nothing to interrupt */
        }
      }
      return next;
    });
  }, [stopLocalAudio]);

  /**
   * The evidence chips, set independently of speech.
   *
   * In `passthrough` mode `speak()` carries the citation because the same call
   * produces the audio. In `conversational` mode the vendor produces the audio
   * and our own `/rag/ask` produces the citation, so the two arrive separately
   * and the chip must not depend on a `speak()` that never happens.
   */
  const setEvidence = useCallback(
    (evidence: { citation?: string | null; notSure?: boolean }) => {
      if (evidence.citation !== undefined) setCitation(evidence.citation);
      if (evidence.notSure !== undefined) {
        setNotSure(evidence.notSure);
        // The amber shield and the amber halo are the same signal, so an
        // abstention sets the mood too. A grounded answer does not: the vendor
        // owns the mood while it is speaking, and overriding it would make the
        // halo flicker against the voice.
        if (evidence.notSure) setMood('not_sure');
      }
    },
    [],
  );

  /** The citizen's own microphone. Only meaningful in `conversational` mode. */
  const toggleMic = useCallback(() => {
    setMicMuted((prev) => {
      const next = !prev;
      const client = clientRef.current;
      if (client) {
        try {
          if (next) client.muteInputAudio();
          else client.unmuteInputAudio();
        } catch {
          /* not streaming: the button still reflects intent */
        }
      }
      return next;
    });
  }, []);

  // Session clock: one interval drives the countdown, the idle timeout and the
  // hard cap. A single timer means the three can never disagree.
  useEffect(() => {
    if (state !== 'ready' && state !== 'speaking' && state !== 'degraded') return;
    const tick = () => {
      const now = Date.now();
      const elapsed = Math.floor((now - startedAtRef.current) / 1000);
      const left = Math.max(0, maxSeconds - elapsed);
      setSecondsLeft(left);
      if (left <= 0) {
        void disconnect();
        return;
      }
      const idleFor = (now - lastActivityRef.current) / 1000;
      if (idleFor >= idleSeconds && !speakingRef.current) void disconnect();
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [state, maxSeconds, idleSeconds, disconnect]);

  // A hidden tab is a session nobody is watching. Free the credit.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void disconnect();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [disconnect]);

  // Unmount is the last line of defence: a route change must never leave a peer
  // connection open and billing.
  useEffect(
    () => () => {
      void teardown();
    },
    [teardown],
  );

  return useMemo<AnamAvatarController>(
    () => ({
      state,
      mood,
      caption,
      citation,
      notSure,
      muted,
      secondsLeft,
      warning: secondsLeft <= RENEW_WARNING_SECONDS,
      provider,
      mode,
      conversational,
      simulated,
      videoId,
      degradedMessage,
      micMuted,
      micDenied,
      connect,
      disconnect,
      renew,
      interrupt,
      toggleMute,
      toggleMic,
      speak,
      setEvidence,
      sendTextToAvatar,
      onTurn,
    }),
    [
      state,
      mood,
      caption,
      citation,
      notSure,
      muted,
      secondsLeft,
      provider,
      mode,
      conversational,
      simulated,
      videoId,
      degradedMessage,
      micMuted,
      micDenied,
      connect,
      disconnect,
      renew,
      interrupt,
      toggleMute,
      toggleMic,
      speak,
      setEvidence,
      sendTextToAvatar,
      onTurn,
    ],
  );
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getAccessToken } from '../auth/session';
import { STORAGE_KEYS } from '../config';
import { audioUrl, hasAudio, loadManifest, resolveAudioKey } from './manifest';

/**
 * One shared <audio> element for the whole app.
 *
 * Playback order for a prompt:
 *   1. pre-cached static MP3 from `public/audio/ur/<key>.mp3` (0 ms, works offline)
 *   2. dynamic TTS via `POST /voice/tts` for signed-in users
 *   3. browser TTS when a clip or server TTS is unavailable
 */
interface AudioContextValue {
  play(key: string | null | undefined, fallbackText?: string | null): Promise<void>;
  stop(): void;
  speaking: boolean;
  autoRead: boolean;
  setAutoRead(next: boolean): void;
  /** True once the manifest has been read (used to hide the button when no audio exists). */
  ready: boolean;
}

const AudioCtx = createContext<AudioContextValue | null>(null);

function readAutoRead(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.autoRead);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    /* ignore */
  }
  return true; // ON by default for citizens (docs/11 §2.2)
}

export function AudioProvider({ children }: { children: ReactNode }) {
  const elRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [autoRead, setAutoReadState] = useState(readAutoRead);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void loadManifest().then(() => setReady(true));
  }, []);

  const stop = useCallback(() => {
    utteranceRef.current = null;
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    const el = elRef.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setSpeaking(false);
  }, []);

  const playUrl = useCallback(
    async (url: string, ownedObjectUrl = false): Promise<boolean> => {
      stop();
      const el = elRef.current ?? new Audio();
      elRef.current = el;
      if (ownedObjectUrl) objectUrlRef.current = url;
      el.src = url;
      el.onended = () => setSpeaking(false);
      el.onerror = () => setSpeaking(false);
      try {
        await el.play();
        setSpeaking(true);
        return true;
      } catch {
        stop();
        return false;
      }
    },
    [stop],
  );

  const playBrowser = useCallback(
    (text: string, fallbackText?: string | null): void => {
      if (typeof window === 'undefined' || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
      stop();
      const voices = window.speechSynthesis.getVoices();
      const hasUrdu = voices.some((voice) => voice.lang.toLowerCase().startsWith('ur'));
      const spokenText = !hasUrdu && /[\u0600-\u06ff]/.test(text) && fallbackText && !/[\u0600-\u06ff]/.test(fallbackText)
        ? fallbackText
        : text;
      const utterance = new SpeechSynthesisUtterance(spokenText);
      const lang = /[\u0600-\u06ff]/.test(spokenText) ? 'ur-PK' : 'en-US';
      utterance.lang = lang;
      utterance.voice = voices.find((voice) => voice.lang.toLowerCase().startsWith(lang.slice(0, 2))) ?? null;
      utterance.onend = utterance.onerror = () => {
        if (utteranceRef.current === utterance) {
          utteranceRef.current = null;
          setSpeaking(false);
        }
      };
      utteranceRef.current = utterance;
      try {
        window.speechSynthesis.speak(utterance);
        setSpeaking(true);
      } catch {
        utteranceRef.current = null;
        setSpeaking(false);
      }
    },
    [stop],
  );

  const playDynamic = useCallback(
    async (text: string): Promise<boolean> => {
      const token = getAccessToken();
      if (!token || !navigator.onLine) return false;
      try {
        const res = await fetch('/api/v1/voice/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ text, lang: 'ur' }),
        });
        if (!res.ok) return false;
        const type = res.headers.get('Content-Type') ?? '';
        if (type.includes('application/json')) {
          const json = (await res.json()) as { audio_url?: string; url?: string };
          const url = json.audio_url ?? json.url;
          return url ? playUrl(url) : false;
        }
        // The fake provider returns a silent WAV. Let the browser speak instead.
        if (type.includes('audio/wav')) return false;
        if (!type.startsWith('audio/')) return false;
        const blob = await res.blob();
        if (blob.size === 0) return false;
        const objectUrl = URL.createObjectURL(blob);
        return playUrl(objectUrl, true);
      } catch {
        return false;
      }
    },
    [playUrl],
  );

  const play = useCallback(
    async (key: string | null | undefined, fallbackText?: string | null) => {
      let text = fallbackText ?? null;
      if (key) {
        const manifest = await loadManifest();
        const resolved = resolveAudioKey(key);
        text = manifest[resolved] ?? text;
        if (hasAudio(resolved) && await playUrl(audioUrl(resolved))) {
          return;
        }
      }
      if (text) {
        if (!await playDynamic(text)) playBrowser(text, fallbackText);
      }
    },
    [playUrl, playDynamic, playBrowser],
  );

  const setAutoRead = useCallback((next: boolean) => {
    setAutoReadState(next);
    try {
      localStorage.setItem(STORAGE_KEYS.autoRead, String(next));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => () => stop(), [stop]);

  const value = useMemo<AudioContextValue>(
    () => ({ play, stop, speaking, autoRead, setAutoRead, ready }),
    [play, stop, speaking, autoRead, setAutoRead, ready],
  );

  return <AudioCtx.Provider value={value}>{children}</AudioCtx.Provider>;
}

export function useAudio(): AudioContextValue {
  const ctx = useContext(AudioCtx);
  if (!ctx) throw new Error('useAudio must be used inside <AudioProvider>');
  return ctx;
}

/**
 * Plays a screen prompt once on mount when "Auto-read screens" is on.
 * Never re-plays on re-render, and never blocks the screen.
 */
export function useAutoReadPrompt(key: string | null | undefined, text?: string | null): void {
  const { autoRead, play } = useAudio();
  const played = useRef(false);
  useEffect(() => {
    if (!autoRead || played.current || !key) return;
    played.current = true;
    void play(key, text ?? null);
  }, [autoRead, key, text, play]);
}

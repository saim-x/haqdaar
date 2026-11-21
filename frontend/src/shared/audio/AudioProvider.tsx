import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getAccessToken } from '../auth/session';
import { STORAGE_KEYS } from '../config';
import { audioUrl, loadManifest, resolveAudioKey } from './manifest';

/**
 * One shared <audio> element for the whole app.
 *
 * Playback order for a prompt:
 *   1. pre-cached static MP3 from `public/audio/ur/<key>.mp3` (0 ms, works offline)
 *   2. dynamic TTS via `POST /voice/tts` for signed-in users
 *   3. browser TTS when a clip or server TTS is unavailable
 */
interface AudioContextValue {
  play(key: string | null | undefined, fallbackText?: string | null, control?: string): Promise<void>;
  stop(): void;
  activeControl: string | null;
  loadingControl: string | null;
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
  const playbackRef = useRef<AbortController | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [activeControl, setActiveControl] = useState<string | null>(null);
  const [loadingControl, setLoadingControl] = useState<string | null>(null);
  const [autoRead, setAutoReadState] = useState(readAutoRead);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void loadManifest().then(() => setReady(true));
  }, []);

  const stop = useCallback(() => {
    playbackRef.current?.abort();
    playbackRef.current = null;
    utteranceRef.current = null;
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    const el = elRef.current;
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
    setActiveControl(null);
    setLoadingControl(null);
  }, []);

  const playAudioResponse = useCallback(
    async (res: Response, signal: AbortSignal): Promise<boolean> => {
      if (!res.ok || !res.headers.get('Content-Type')?.startsWith('audio/')) return false;
      const blob = await res.blob();
      if (signal.aborted || blob.size === 0) return false;

      const url = URL.createObjectURL(blob);
      const el = elRef.current ?? new Audio();
      elRef.current = el;
      objectUrlRef.current = url;
      el.src = url;
      try {
        await el.play();
        if (signal.aborted) return false;
        el.onended = el.onerror = () => {
          if (!signal.aborted) stop();
        };
        return true;
      } catch {
        if (!signal.aborted && objectUrlRef.current === url) {
          URL.revokeObjectURL(url);
          objectUrlRef.current = null;
        }
        return false;
      }
    },
    [stop],
  );

  const playClip = useCallback(
    async (key: string, signal: AbortSignal): Promise<boolean> => {
      try {
        // Read the full clip through the media range path, then play a local blob.
        const res = await fetch(audioUrl(key), { signal, headers: { Range: 'bytes=0-' } });
        return await playAudioResponse(res, signal);
      } catch {
        return false;
      }
    },
    [playAudioResponse],
  );

  const playBrowser = useCallback(
    (text: string, fallbackText?: string | null): void => {
      if (typeof window === 'undefined' || !window.speechSynthesis || !window.SpeechSynthesisUtterance) {
        stop();
        return;
      }
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
        if (utteranceRef.current === utterance) stop();
      };
      utteranceRef.current = utterance;
      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        stop();
      }
    },
    [stop],
  );

  const playDynamic = useCallback(
    async (text: string, signal: AbortSignal): Promise<boolean> => {
      const token = getAccessToken();
      if (!token || !navigator.onLine) return false;
      try {
        const res = await fetch('/api/v1/voice/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ text, lang: 'ur' }),
          signal,
        });
        if (!res.ok) return false;
        const type = res.headers.get('Content-Type') ?? '';
        if (type.includes('application/json')) {
          const json = (await res.json()) as { audio_url?: string; url?: string };
          const url = json.audio_url ?? json.url;
          return url ? await playAudioResponse(await fetch(url, { signal }), signal) : false;
        }
        // The fake provider returns a silent WAV. Let the browser speak instead.
        if (type.includes('audio/wav')) return false;
        return await playAudioResponse(res, signal);
      } catch {
        return false;
      }
    },
    [playAudioResponse],
  );

  const play = useCallback(
    async (key: string | null | undefined, fallbackText?: string | null, control?: string) => {
      stop();
      setActiveControl(control ?? null);
      const playback = new AbortController();
      playbackRef.current = playback;
      const { signal } = playback;
      let text = fallbackText ?? null;
      if (key) {
        if (await playClip(key, signal) || signal.aborted) return;
        const manifest = await loadManifest();
        if (signal.aborted) return;
        const resolved = resolveAudioKey(key);
        text = manifest[resolved] ?? text;
        if (resolved !== key && await playClip(resolved, signal)) {
          return;
        }
      }
      if (text && !signal.aborted) {
        setLoadingControl(control ?? null);
        if (!await playDynamic(text, signal) && !signal.aborted) playBrowser(text, fallbackText);
        setLoadingControl(null);
      } else if (!signal.aborted) {
        stop();
      }
    },
    [playClip, playDynamic, playBrowser, stop],
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
    () => ({ play, stop, activeControl, loadingControl, autoRead, setAutoRead, ready }),
    [play, stop, activeControl, loadingControl, autoRead, setAutoRead, ready],
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
  const lastPlayedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!autoRead || !key || lastPlayedKey.current === key) return;
    lastPlayedKey.current = key;
    void play(key, text ?? null);
  }, [autoRead, key, text, play]);
}

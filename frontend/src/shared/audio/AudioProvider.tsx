import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { STORAGE_KEYS } from '../config';
import { audioUrl, loadManifest } from './manifest';

/**
 * One shared <audio> element for the whole app.
 *
 * Playback order for a prompt:
 *   1. pre-cached static MP3 from `public/audio/ur/<key>.mp3` (0 ms, works offline)
 *   2. dynamic TTS via `POST /voice/tts` when only text is available
 *   3. silence — never an error toast, never a blocked flow
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
  const [speaking, setSpeaking] = useState(false);
  const [autoRead, setAutoReadState] = useState(readAutoRead);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void loadManifest().then(() => setReady(true));
  }, []);

  const stop = useCallback(() => {
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
    async (url: string) => {
      stop();
      const el = elRef.current ?? new Audio();
      elRef.current = el;
      el.src = url;
      el.onended = () => setSpeaking(false);
      el.onerror = () => setSpeaking(false);
      try {
        await el.play();
        setSpeaking(true);
      } catch {
        setSpeaking(false);
      }
    },
    [stop],
  );

  const playDynamic = useCallback(
    async (text: string) => {
      try {
        const res = await fetch('/api/v1/voice/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, lang: 'ur' }),
        });
        if (!res.ok) return;
        const type = res.headers.get('Content-Type') ?? '';
        if (type.includes('application/json')) {
          const json = (await res.json()) as { audio_url?: string; url?: string };
          const url = json.audio_url ?? json.url;
          if (url) await playUrl(url);
          return;
        }
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objectUrl;
        await playUrl(objectUrl);
      } catch {
        /* silent degrade */
      }
    },
    [playUrl],
  );

  const play = useCallback(
    async (key: string | null | undefined, fallbackText?: string | null) => {
      if (key) {
        const manifest = await loadManifest();
        if (key in manifest) {
          await playUrl(audioUrl(key));
          return;
        }
      }
      if (fallbackText) {
        await playDynamic(fallbackText);
        return;
      }
      // Nothing to play: stay silent rather than showing an error.
    },
    [playUrl, playDynamic],
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

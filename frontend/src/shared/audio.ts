import { useSyncExternalStore } from 'react';

// Audio-first prompts (docs/11 §2.2). Order of preference:
//   1. Pre-generated Urdu MP3 at /audio/ur/<key>.mp3 (precached by the service worker, works offline)
//   2. Dynamic TTS URL from the API (for personalised text such as amounts)
//   3. Browser speechSynthesis as a last resort so a prompt is never silent.

let current: HTMLAudioElement | null = null;
let playingId: string | null = null;
const listeners = new Set<() => void>();
const missing = new Set<string>();

function setPlaying(id: string | null) {
  playingId = id;
  listeners.forEach((l) => l());
}

export function stopAudio() {
  if (current) {
    current.pause();
    current = null;
  }
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  setPlaying(null);
}

function speak(text: string, lang: 'ur' | 'en', id: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === 'undefined' || !text) {
      setPlaying(null);
      resolve();
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === 'ur' ? 'ur-PK' : 'en-GB';
    const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
    if (voice) u.voice = voice;
    u.rate = 0.92;
    u.onend = u.onerror = () => {
      if (playingId === id) setPlaying(null);
      resolve();
    };
    speechSynthesis.speak(u);
  });
}

function playUrl(url: string, id: string): Promise<boolean> {
  return new Promise((resolve) => {
    const a = new Audio(url);
    current = a;
    a.onended = () => {
      if (playingId === id) setPlaying(null);
      resolve(true);
    };
    a.onerror = () => resolve(false);
    a.play().catch(() => resolve(false));
  });
}

export interface PlayOptions {
  /** Static prompt key → /audio/ur/<key>.mp3 */
  clip?: string;
  /** Spoken fallback text (and the text for dynamic TTS). */
  text: string;
  lang: 'ur' | 'en';
  /** Optional dynamic TTS URL resolver. */
  ttsUrl?: () => Promise<string | null>;
}

export async function play(opts: PlayOptions): Promise<void> {
  const id = `${opts.clip ?? ''}|${opts.text}`;
  stopAudio();
  setPlaying(id);

  if (opts.clip && opts.lang === 'ur' && !missing.has(opts.clip)) {
    const ok = await playUrl(`/audio/ur/${opts.clip}.mp3`, id);
    if (ok) return;
    missing.add(opts.clip);
  }
  if (opts.ttsUrl) {
    try {
      const url = await opts.ttsUrl();
      if (url && playingId === id && (await playUrl(url, id))) return;
    } catch {
      /* fall through to speech synthesis */
    }
  }
  if (playingId === id) await speak(opts.text, opts.lang, id);
}

export function usePlayingId(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => playingId,
    () => playingId,
  );
}

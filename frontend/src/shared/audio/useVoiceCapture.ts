import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderState = 'idle' | 'recording' | 'ready' | 'unsupported' | 'denied';

export interface VoiceCapture {
  state: RecorderState;
  seconds: number;
  blob: Blob | null;
  start(): Promise<void>;
  stop(): void;
  reset(): void;
  error: string | null;
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

/**
 * Minimal MediaRecorder wrapper - docs/11 §2.3.
 * Voice is always an accelerator: every caller must render a tap/keypad path
 * next to it, and `unsupported`/`denied` must degrade silently, never block.
 */
export function useVoiceCapture(maxSeconds = 15): VoiceCapture {
  const [state, setState] = useState<RecorderState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<BlobPart[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);

  const teardown = useCallback(() => {
    if (ticker.current) {
      clearInterval(ticker.current);
      ticker.current = null;
    }
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    recorder.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  const stop = useCallback(() => {
    if (recorder.current && recorder.current.state !== 'inactive') {
      recorder.current.stop();
    }
    if (ticker.current) {
      clearInterval(ticker.current);
      ticker.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setBlob(null);
    setSeconds(0);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setState('unsupported');
      return;
    }

    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      chunks.current = [];
      const mimeType = pickMimeType();
      const rec = mimeType ? new MediaRecorder(media, { mimeType }) : new MediaRecorder(media);
      recorder.current = rec;

      rec.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      rec.onstop = () => {
        const type = rec.mimeType || 'audio/webm';
        const recorded = new Blob(chunks.current, { type });
        setBlob(recorded);
        setState('ready');
        teardown();
      };

      rec.start();
      setState('recording');
      ticker.current = setInterval(() => {
        setSeconds((prev) => {
          const next = prev + 1;
          if (next >= maxSeconds) stop();
          return next;
        });
      }, 1000);
    } catch {
      setState('denied');
      setError('MIC_DENIED');
      teardown();
    }
  }, [maxSeconds, stop, teardown]);

  const reset = useCallback(() => {
    stop();
    teardown();
    setBlob(null);
    setSeconds(0);
    setError(null);
    setState('idle');
  }, [stop, teardown]);

  return { state, seconds, blob, start, stop, reset, error };
}

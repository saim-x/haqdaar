import { Check, Mic, RotateCcw, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../shared/api/client';
import { ai } from '../../shared/api/endpoints';
import type { VoiceParseResponse } from '../../shared/api/types';
import { play } from '../../shared/audio';
import { useT } from '../../shared/i18n';
import { useOnline } from '../../shared/offline/outbox';
import { Button } from '../../shared/ui/Button';
import { cx } from '../../shared/ui/cx';
import { Spinner } from '../../shared/ui/Spinner';

const canRecord = () =>
  typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

/**
 * Voice is an accelerator, never a single point of failure (docs/11 §2.5).
 * After parsing, a readback card must be confirmed before the value is stored
 * as confirmed (AC-03.4). Hidden when offline or unsupported: taps still work.
 */
export function VoiceCapture({
  fieldKey,
  format,
  onConfirm,
}: {
  fieldKey: string;
  format: (v: VoiceParseResponse) => string;
  onConfirm: (r: VoiceParseResponse) => void;
}) {
  const { t, lang, pick } = useT();
  const online = useOnline();
  const [state, setState] = useState<'idle' | 'recording' | 'parsing' | 'readback' | 'error'>('idle');
  const [result, setResult] = useState<VoiceParseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (stopTimer.current) clearTimeout(stopTimer.current);
      recorder.current?.stream.getTracks().forEach((tr) => tr.stop());
    },
    [],
  );

  if (!canRecord() || !online) return null;

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' });
        setState('parsing');
        try {
          const r = await ai.transcribeParse(blob, fieldKey, lang);
          if (r.needs_retry || (r.parsed_value === null && !r.missing_reason)) {
            setState('error');
            setError(t('voiceFailed'));
            void play({ text: t('voiceFailed'), lang, clip: 'voice_failed' });
            return;
          }
          setResult(r);
          setState('readback');
          void play({ text: pick(r.readback_ur, r.readback_en), lang });
        } catch (e) {
          setState('error');
          setError(e instanceof ApiError ? pick(e.messageUr, e.message) : t('voiceFailed'));
        }
      };
      recorder.current = rec;
      rec.start();
      setState('recording');
      stopTimer.current = setTimeout(() => rec.state === 'recording' && rec.stop(), 12000);
    } catch {
      setState('error');
      setError(t('voiceFailed'));
    }
  };

  const stop = () => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
  };

  if (state === 'readback' && result) {
    return (
      <div role="dialog" aria-label={t('isThisCorrect')} className="rounded-card border-2 border-brand bg-brand-soft p-4 animate-rise">
        <p className="text-sm font-semibold text-brand">{t('youSaid')}</p>
        <p className="my-2 text-3xl font-bold">{format(result)}</p>
        <p className="mb-4 text-muted">{pick(result.readback_ur, result.readback_en)}</p>
        <div className="grid grid-cols-2 gap-3">
          <Button
            size="xl"
            variant="success"
            icon={<Check className="h-8 w-8" aria-hidden />}
            onClick={() => {
              onConfirm(result);
              setResult(null);
              setState('idle');
            }}
          >
            {t('yes')}
          </Button>
          <Button
            size="xl"
            variant="secondary"
            icon={<RotateCcw className="h-7 w-7" aria-hidden />}
            onClick={() => {
              setResult(null);
              setState('idle');
            }}
          >
            {t('tryAgain')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={state === 'recording' ? stop : () => void start()}
        disabled={state === 'parsing'}
        aria-pressed={state === 'recording'}
        className={cx(
          'flex min-h-tap-lg w-full items-center justify-center gap-3 rounded-card border-2 px-4 text-lg font-bold transition-colors duration-fast',
          state === 'recording' ? 'border-danger bg-danger text-white' : 'border-brand/40 bg-surface text-brand hover:border-brand',
        )}
      >
        {state === 'parsing' ? (
          <Spinner className="h-6 w-6" />
        ) : state === 'recording' ? (
          <Square className="h-6 w-6" aria-hidden />
        ) : (
          <Mic className="h-7 w-7" aria-hidden />
        )}
        {state === 'recording' ? t('recording') : state === 'parsing' ? t('processingVoice') : t('speak')}
      </button>
      {error && (
        <p role="alert" className="text-center font-medium text-warn">
          {error}
        </p>
      )}
    </div>
  );
}

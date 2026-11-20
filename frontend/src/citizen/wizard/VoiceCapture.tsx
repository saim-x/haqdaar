import { Check, Ear, Mic, RotateCcw, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../shared/api/client';
import { ai } from '../../shared/api/endpoints';
import type { MissingReason } from '../../shared/api/types';
import { play } from '../../shared/audio';
import { useT } from '../../shared/i18n';
import { useOnline } from '../../shared/offline/outbox';
import { saysUnknown } from '../../shared/voice/parse';
import { listen, speechRecognitionSupported } from '../../shared/voice/recognition';
import { Button } from '../../shared/ui/Button';
import { cx } from '../../shared/ui/cx';
import { Spinner } from '../../shared/ui/Spinner';

export interface VoiceResult {
  value: string | number | null;
  /** What is shown big on the confirmation card. */
  display: string;
  transcript: string;
  missing_reason?: MissingReason;
}

/** Returns null when the transcript does not contain a usable answer for this field. */
export type FieldParser = (transcript: string) => { value: string | number; display: string } | null;

const canRecordAudio = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

/**
 * Voice is an accelerator, never a single point of failure (docs/11 §2.5).
 * Primary path: the browser's speech recognizer hears the citizen (ur-PK / English) and the
 * transcript is parsed for this one field. Fallback: record audio and send it to
 * POST /voice/transcribe-parse (Whisper). Either way the value is read back and only
 * stored after the citizen taps Yes (AC-03.4). Nothing is ever filled in by default.
 */
export function VoiceCapture({ fieldKey, parse, allowUnknown, onConfirm }: { fieldKey: string; parse: FieldParser; allowUnknown?: boolean; onConfirm: (r: VoiceResult) => void }) {
  const { t, lang, pick } = useT();
  const online = useOnline();
  const [state, setState] = useState<'idle' | 'listening' | 'parsing' | 'readback' | 'error'>('idle');
  const [interim, setInterim] = useState('');
  const [result, setResult] = useState<VoiceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const useBrowser = speechRecognitionSupported();

  useEffect(() => () => stopRef.current?.(), []);
  if (!online || (!useBrowser && !canRecordAudio())) return null;

  const readback = (r: VoiceResult) => {
    setResult(r);
    setState('readback');
    const text =
      lang === 'ur'
        ? r.missing_reason
          ? 'آپ نے بتایا کہ آپ کو معلوم نہیں۔ کیا یہ درست ہے؟'
          : `آپ نے ${r.display} بتایا۔ کیا یہ درست ہے؟`
        : r.missing_reason
          ? "You said you don't know. Is that correct?"
          : `You said ${r.display}. Is that correct?`;
    void play({ text, lang });
  };

  const fail = (heard: string) => {
    setState('error');
    const msg = heard
      ? lang === 'ur'
        ? `ہم نے سنا: "${heard}"، مگر جواب سمجھ نہیں آیا۔ دوبارہ بولیں یا بٹن دبائیں۔`
        : `We heard "${heard}" but could not find an answer in it. Try again or use the buttons.`
      : t('voiceFailed');
    setError(msg);
    void play({ text: heard ? msg : t('voiceFailed'), lang, clip: heard ? undefined : 'voice_failed' });
  };

  const handleTranscripts = (alts: string[]) => {
    const heard = alts[0]?.trim() ?? '';
    if (!heard) return fail('');
    if (allowUnknown && alts.some(saysUnknown)) return readback({ value: null, display: t('unknownAnswer'), transcript: heard, missing_reason: 'USER_UNKNOWN' });
    for (const a of alts) {
      const p = parse(a);
      if (p) return readback({ ...p, transcript: a.trim() });
    }
    fail(heard);
  };

  const startBrowser = () => {
    setError(null);
    setInterim('');
    setState('listening');
    stopRef.current = listen(lang, {
      onInterim: setInterim,
      onFinal: (alts) => handleTranscripts(alts.map((a) => a.transcript)),
      onError: (code) => {
        if (code === 'no-speech' || code === 'aborted') return;
        setState('error');
        setError(
          code === 'not-allowed'
            ? pick('مائیک کی اجازت نہیں ملی۔ براؤزر میں مائیک کی اجازت دیں۔', 'Microphone permission was denied. Allow the microphone in the browser.')
            : code === 'language-not-supported'
              ? pick('یہ براؤزر اردو آواز نہیں سمجھتا۔ English میں بولیں یا بٹن دبائیں۔', 'This browser cannot recognise Urdu speech. Switch to English or use the buttons.')
              : t('voiceFailed'),
        );
      },
      onEnd: () => {
        stopRef.current = null;
        setState((s) => (s === 'listening' ? 'idle' : s));
      },
    });
  };

  const startServer = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setState('parsing');
        try {
          const r = await ai.transcribeParse(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), fieldKey, lang);
          if (r.missing_reason === 'USER_UNKNOWN' && allowUnknown) return readback({ value: null, display: t('unknownAnswer'), transcript: r.transcript, missing_reason: 'USER_UNKNOWN' });
          if (r.needs_retry || r.parsed_value === null) return fail(r.transcript);
          readback({ value: r.parsed_value, display: String(r.parsed_value), transcript: r.transcript });
        } catch (e) {
          setState('error');
          setError(e instanceof ApiError ? pick(e.messageUr, e.message) : t('voiceFailed'));
        }
      };
      recorder.current = rec;
      rec.start();
      setState('listening');
      setTimeout(() => rec.state === 'recording' && rec.stop(), 12000);
    } catch {
      setState('error');
      setError(t('voiceFailed'));
    }
  };

  const stop = () => {
    if (useBrowser) stopRef.current?.();
    else if (recorder.current?.state === 'recording') recorder.current.stop();
  };

  if (state === 'readback' && result) {
    return (
      <div role="dialog" aria-label={t('isThisCorrect')} className="rounded-card border-2 border-primary bg-primary-soft p-4 animate-rise">
        <p className="text-sm font-semibold text-primary">{t('youSaid')}</p>
        <p className="my-2 break-words text-3xl font-bold">{result.display}</p>
        <p className="mb-4 flex items-start gap-1.5 text-sm text-muted-foreground">
          <Ear className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>“{result.transcript}”</span>
        </p>
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
          <Button size="xl" variant="secondary" icon={<RotateCcw className="h-7 w-7" aria-hidden />} onClick={() => { setResult(null); setState('idle'); }}>
            {t('tryAgain')}
          </Button>
        </div>
      </div>
    );
  }

  const listening = state === 'listening';
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={listening ? stop : () => (useBrowser ? startBrowser() : void startServer())}
        disabled={state === 'parsing'}
        aria-pressed={listening}
        className={cx(
          'relative flex min-h-tap-lg w-full items-center justify-center gap-3 overflow-hidden rounded-card border-2 px-4 text-lg font-bold transition-colors duration-fast',
          listening ? 'border-danger bg-danger text-white' : 'border-primary/40 bg-card text-primary hover:border-primary',
        )}
      >
        {listening && <span className="absolute inset-0 animate-pulse bg-white/10" aria-hidden />}
        {state === 'parsing' ? <Spinner className="h-6 w-6" /> : listening ? <Square className="h-6 w-6" aria-hidden /> : <Mic className="h-7 w-7" aria-hidden />}
        {listening ? t('recording') : state === 'parsing' ? t('processingVoice') : t('speak')}
      </button>
      {listening && (
        <p aria-live="polite" className="min-h-[1.5rem] text-center text-lg font-medium text-muted-foreground">
          {interim || (lang === 'ur' ? 'بولیں…' : 'Speak now…')}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-control bg-warn-soft p-3 text-center font-medium text-warn">
          {error}
        </p>
      )}
    </div>
  );
}

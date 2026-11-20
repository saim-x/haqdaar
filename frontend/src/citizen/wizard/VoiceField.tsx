import { useEffect, useState } from 'react';
import { api } from '../../shared/api/client';
import { errorMessage } from '../../shared/api/errors';
import type { VoiceParseResult } from '../../shared/api/types';
import { useVoiceCapture } from '../../shared/audio/useVoiceCapture';
import { useI18n } from '../../shared/i18n/I18nProvider';
import { AudioButton } from '../../shared/ui/AudioButton';
import { IconCheck, IconCross, IconMic } from '../../shared/ui/Icons';

interface VoiceFieldProps {
  fieldKey: string;
  /** Called only after the citizen taps ✅ on the read-back. */
  onConfirm(value: string | number | boolean | null): void;
  audioKey?: string;
  audioText?: string;
}

/**
 * Voice input with mandatory read-back — docs/11 §2.3, docs/07 §2.
 *
 * The value is never stored on the strength of the transcript alone: the parsed
 * value is shown, spoken back in Urdu, and only written when the citizen taps ✅.
 * When the microphone is unavailable this component renders nothing at all —
 * voice is an accelerator, never a single point of failure.
 */
export function VoiceField({ fieldKey, onConfirm, audioKey, audioText }: VoiceFieldProps) {
  const { t, lang } = useI18n();
  const capture = useVoiceCapture(12);
  const [parsed, setParsed] = useState<VoiceParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readyBlob = capture.state === 'ready' ? capture.blob : null;

  // The recorder hands the blob back after `stop()`; upload it once.
  useEffect(() => {
    if (!readyBlob) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('audio', readyBlob, 'answer.webm');
    form.append('field_key', fieldKey);
    form.append('lang', 'ur');
    api
      .upload<VoiceParseResult>('/voice/transcribe-parse', form)
      .then((result) => {
        if (!cancelled) setParsed(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err, lang));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [readyBlob, fieldKey, lang]);

  if (capture.state === 'unsupported' || capture.state === 'denied') return null;

  return (
    <div className="mt-3">
      {!parsed && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => (capture.state === 'recording' ? capture.stop() : void capture.start())}
            disabled={busy}
            className={`inline-flex min-h-primary flex-1 items-center justify-center gap-2 rounded-2xl border-2 text-base font-bold ${
              capture.state === 'recording'
                ? 'border-[#B42318] bg-[#B42318] text-white'
                : 'border-teal-600 bg-white text-teal-700'
            } disabled:opacity-60`}
          >
            <IconMic size={22} />
            {capture.state === 'recording'
              ? `${t('wizard.voice.listening')} ${capture.seconds}s`
              : busy
                ? t('common.loading')
                : t('common.speak')}
          </button>
          <AudioButton audioKey={audioKey} text={audioText} />
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs font-semibold text-[#B42318]">
          {error}
        </p>
      )}

      {parsed && (
        <div className="rounded-2xl border-2 border-teal-600 bg-teal-50 p-3">
          <p className="text-[11px] font-bold uppercase text-teal-800">{t('wizard.readback.question')}</p>
          <div className="mt-1 flex items-center gap-2">
            <p className="num flex-1 text-xl font-bold text-ink" dir="auto">
              {parsed.parsed_value === null || parsed.parsed_value === ''
                ? t('wizard.voice.notUnderstood')
                : String(parsed.parsed_value)}
            </p>
            <AudioButton audioKey={null} text={parsed.readback_ur} />
          </div>
          <p className="mt-1 text-[11px] text-ink-soft">{parsed.transcript}</p>

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setParsed(null);
                capture.reset();
              }}
              className="inline-flex min-h-tap flex-1 items-center justify-center gap-1 rounded-xl border-2 border-ink/20 bg-white text-sm font-bold text-ink"
            >
              <IconCross size={16} />
              {t('wizard.readback.no')}
            </button>
            <button
              type="button"
              disabled={parsed.needs_retry || parsed.parsed_value === null}
              onClick={() => {
                onConfirm(parsed.parsed_value);
                setParsed(null);
                capture.reset();
              }}
              className="inline-flex min-h-tap flex-1 items-center justify-center gap-1 rounded-xl border-2 border-[#0B5F31] bg-[#0F7B3F] text-sm font-bold text-white disabled:opacity-50"
            >
              <IconCheck size={16} />
              {t('wizard.readback.yes')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

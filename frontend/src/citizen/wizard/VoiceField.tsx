import { useEffect, useState } from 'react';
import { api } from '../../shared/api/client';
import { errorMessage } from '../../shared/api/errors';
import type { VoiceParseResult } from '../../shared/api/types';
import { useAudio } from '../../shared/audio/AudioProvider';
import { useVoiceCapture } from '../../shared/audio/useVoiceCapture';
import { useI18n } from '../../shared/i18n/I18nProvider';
import { AudioButton } from '../../shared/ui/AudioButton';
import { IconCheck, IconCross, IconMic } from '../../shared/ui/Icons';

interface VoiceFieldProps {
  fieldKey: string;
  /** Called only after the citizen confirms the read-back. */
  onConfirm(value: string | number | boolean | null, missingReason?: string | null): void;
  valueText?: string;
}

export function VoiceField({ fieldKey, onConfirm, valueText }: VoiceFieldProps) {
  const { t, lang, isRtl } = useI18n();
  const { play, stop } = useAudio();
  const numeric = fieldKey.endsWith('_cnic') || fieldKey === 'payout_phone' || fieldKey === 'applicant_dob';
  const capture = useVoiceCapture(numeric ? 25 : 12, true);
  const [parsed, setParsed] = useState<VoiceParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState('');

  const readyBlob = capture.state === 'ready' ? capture.blob : null;
  const recording = capture.state === 'recording';
  const snapshot = capture.snapshot;

  useEffect(() => {
    if (!recording) return;
    const controller = new AbortController();
    let pending = false;
    let submittedBytes = 0;
    const timer = setInterval(() => {
      if (pending) return;
      const audio = snapshot();
      if (!audio || audio.size === submittedBytes) return;
      submittedBytes = audio.size;
      pending = true;
      const form = new FormData();
      form.append('audio', audio, 'preview');
      void api.upload<{ transcript: string }>('/rag/transcribe', form, { signal: controller.signal })
        .then(({ transcript }) => {
          if (!controller.signal.aborted && transcript) setPreview(transcript);
        })
        .catch(() => {
          // The complete recording is still transcribed when the user stops.
        })
        .finally(() => { pending = false; });
    }, 1800);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [recording, snapshot]);

  // The recorder hands the blob back after `stop()`; upload it once.
  useEffect(() => {
    if (!readyBlob) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('audio', readyBlob, 'answer.webm');
    form.append('field_key', fieldKey);
    form.append('lang', isRtl ? 'ur' : 'en');
    api
      .upload<VoiceParseResult>('/voice/transcribe-parse', form)
      .then((result) => {
        if (cancelled) return;
        setParsed(result);
        // Mandatory voice readback (docs/11 §2.6): speak the confirmation immediately.
        const spoken = isRtl ? result.readback_ur : result.readback_en;
        if (spoken) void play(null, spoken);
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
  }, [readyBlob, fieldKey, isRtl, lang, play]);

  if (capture.state === 'unsupported') return null;
  if (capture.state === 'denied') {
    return (
      <p className="mt-3 rounded-control bg-raised px-3 py-2 text-meta leading-[1.6] text-ink-2">
        {t('scam.voiceUnavailable')}
      </p>
    );
  }

  const isUserUnknown = parsed?.missing_reason === 'USER_UNKNOWN';
  const canConfirm = Boolean(
    parsed && !parsed.needs_retry && (parsed.parsed_value !== null || isUserUnknown),
  );

  return (
    <div className="mt-3">
      {!parsed && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (recording) {
                capture.stop();
              } else {
                stop();
                setPreview('');
                void capture.start();
              }
            }}
            disabled={busy}
            className={`press inline-flex min-h-primary flex-1 items-center justify-center gap-2 rounded-control border text-body font-medium disabled:opacity-60 ${
              recording
                ? 'border-negative bg-negative text-white'
                : 'border-ink/[0.14] bg-card text-ink hover:bg-raised'
            }`}
          >
            <IconMic size={20} className={recording ? '' : 'text-accent-ink'} />
            {recording
              ? `${t('wizard.voice.listening')} ${capture.seconds}s`
              : busy
                ? t('common.loading')
                : t('common.speak')}
          </button>
          {valueText !== undefined && !recording && !busy && (
            <AudioButton text={valueText || t('wizard.input.empty')} />
          )}
        </div>
      )}

      {!parsed && (recording || busy) && (
        <div className="mt-2 rounded-control bg-raised px-3 py-2" role="status">
          <p className="text-meta font-medium text-ink-2">{t('wizard.voice.preview')}</p>
          <p className="text-body text-ink" dir="auto">{preview || t('wizard.voice.waiting')}</p>
        </div>
      )}
      {numeric && !parsed && (
        <p className="mt-2 text-meta text-ink-3">
          {t(fieldKey === 'applicant_dob' ? 'wizard.voice.sayDate' : 'wizard.voice.sayDigits')}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-meta font-medium text-negative">
          {error}
        </p>
      )}

      {parsed && (
        <div className="card enter p-4">
          <p className="text-meta text-ink-3">{t('wizard.readback.question')}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <p className="flex-1 text-title-lg font-medium tabular-nums text-ink" dir="auto">
              {isUserUnknown
                ? t('common.dontKnow')
                : parsed.parsed_value === null || parsed.parsed_value === ''
                  ? t('wizard.voice.notUnderstood')
                  : String(parsed.parsed_value)}
            </p>
            <AudioButton audioKey={null} text={isRtl ? parsed.readback_ur : parsed.readback_en} />
          </div>
          <p className="mt-1 text-meta leading-[1.7] text-ink-3" dir="auto">{parsed.transcript}</p>
          {numeric && <p className="mt-1 text-meta text-ink-3">{t('wizard.voice.correct')}</p>}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setParsed(null);
                capture.reset();
              }}
              className="press inline-flex min-h-primary flex-1 items-center justify-center gap-1.5 rounded-control border border-ink/[0.14] bg-card text-body font-medium text-ink hover:bg-raised"
            >
              <IconCross size={16} />
              {t('wizard.readback.no')}
            </button>
            <button
              type="button"
              disabled={!canConfirm}
              onClick={() => {
                onConfirm(parsed.parsed_value, parsed.missing_reason);
                setParsed(null);
                capture.reset();
              }}
              className="press inline-flex min-h-primary flex-1 items-center justify-center gap-1.5 rounded-control border border-transparent bg-positive text-body font-medium text-white hover:bg-positive-ink disabled:border-transparent disabled:bg-raised disabled:text-ink-3"
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

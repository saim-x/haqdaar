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
  audioKey?: string;
  audioText?: string;
}

export function VoiceField({ fieldKey, onConfirm, audioKey, audioText }: VoiceFieldProps) {
  const { t, lang, isRtl } = useI18n();
  const { play } = useAudio();
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

  const recording = capture.state === 'recording';
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
            onClick={() => (recording ? capture.stop() : void capture.start())}
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
          <AudioButton audioKey={audioKey} text={audioText} />
        </div>
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
          <p className="mt-1 text-meta leading-[1.7] text-ink-3">{parsed.transcript}</p>

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

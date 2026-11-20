import { useMutation } from '@tanstack/react-query';
import { CircleHelp, ImageUp, Mic, ShieldAlert, ShieldCheck, ShieldQuestion, Square, ThumbsDown, type LucideIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { ApiError } from '../shared/api/client';
import { ai } from '../shared/api/endpoints';
import type { ScamCheckResponse, ScamVerdict } from '../shared/api/types';
import { play } from '../shared/audio';
import { formatDateTime, useT, type DictKey } from '../shared/i18n';
import { useOnline } from '../shared/offline/outbox';
import { listen, speechRecognitionSupported } from '../shared/voice/recognition';
import { AudioButton } from '../shared/ui/AudioButton';
import { Button } from '../shared/ui/Button';
import { cx } from '../shared/ui/cx';
import { useAutoRead } from './useAutoRead';

const VERDICT: Record<ScamVerdict, { icon: LucideIcon; tone: string; solid: string; label: DictKey; clip: string }> = {
  VERIFIED_OFFICIAL: { icon: ShieldCheck, tone: 'border-ok bg-ok-soft', solid: 'bg-ok text-white', label: 'v_VERIFIED_OFFICIAL', clip: 'scam_verified' },
  LIKELY_SAFE: { icon: ShieldCheck, tone: 'border-ok/60 bg-ok-soft', solid: 'bg-ok text-white', label: 'v_LIKELY_SAFE', clip: 'scam_safe' },
  CANNOT_TELL: { icon: ShieldQuestion, tone: 'border-warn bg-warn-soft', solid: 'bg-warn text-white', label: 'v_CANNOT_TELL', clip: 'scam_cannot_tell' },
  LIKELY_SCAM: { icon: ShieldAlert, tone: 'border-danger bg-danger-soft', solid: 'bg-danger text-white', label: 'v_LIKELY_SCAM', clip: 'scam_likely' },
};

/** Public scam & official-message checker (docs/11 §3.4, Challenge 08). Advisory only. */
export function ScamCheck() {
  const { t, lang, pick } = useT();
  const online = useOnline();
  const [tab, setTab] = useState<'text' | 'image' | 'voice'>('text');
  const [text, setText] = useState('');
  const [result, setResult] = useState<ScamCheckResponse | null>(null);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [recording, setRecording] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useAutoRead('scam_intro', `${t('scamTitle')}. ${t('scamSubtitle')}`);

  const onResult = (r: ScamCheckResponse) => {
    setResult(r);
    setFeedbackSent(false);
    void play({ text: `${t(VERDICT[r.verdict].label)}. ${pick(r.explanation_ur, r.explanation_en)}`, lang, clip: VERDICT[r.verdict].clip });
  };
  const check = useMutation({
    mutationFn: async (input: { kind: 'text' } | { kind: 'image'; blob: Blob } | { kind: 'audio'; blob: Blob }) => {
      if (input.kind === 'text') return ai.scamCheck(text.trim());
      if (input.kind === 'image') return ai.scamCheckImage(input.blob);
      return ai.scamCheckAudio(input.blob);
    },
    onSuccess: onResult,
  });
  const feedback = useMutation({
    mutationFn: () => ai.scamFeedback(result!.check_id, 'User disputed the verdict'),
    onSuccess: () => setFeedbackSent(true),
  });

  const [heard, setHeard] = useState('');
  const stopListen = useRef<(() => void) | null>(null);
  // Read the message aloud: the browser recognizer transcribes it, then the text is checked.
  // Without browser recognition, record a voice note for the server (Whisper) instead.
  const startRec = async () => {
    if (speechRecognitionSupported()) {
      setHeard('');
      setRecording(true);
      stopListen.current = listen(lang, {
        onInterim: setHeard,
        onFinal: (alts) => {
          const said = alts[0]?.transcript.trim() ?? '';
          setHeard(said);
          if (said) {
            setText(said);
            setTab('text');
          }
        },
        onError: () => undefined,
        onEnd: () => setRecording(false),
      });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        check.mutate({ kind: 'audio', blob: new Blob(chunks, { type: rec.mimeType || 'audio/webm' }) });
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
      setTimeout(() => rec.state === 'recording' && rec.stop(), 20000);
    } catch {
      /* microphone denied: text and screenshot tabs remain */
    }
  };

  const v = result ? VERDICT[result.verdict] : null;
  const tabs: { id: typeof tab; label: string; icon: LucideIcon }[] = [
    { id: 'text', label: t('tabText'), icon: CircleHelp },
    { id: 'image', label: t('tabImage'), icon: ImageUp },
    { id: 'voice', label: t('tabVoice'), icon: Mic },
  ];

  return (
    <div className="space-y-5 animate-rise">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold leading-tight">{t('scamTitle')}</h1>
          <p className="mt-1 text-lg text-muted">{t('scamSubtitle')}</p>
        </div>
        <AudioButton clip="scam_intro" text={`${t('scamTitle')}. ${t('scamSubtitle')}`} />
      </div>

      <div role="tablist" className="grid grid-cols-3 gap-1 rounded-control bg-sunken p-1">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            role="tab"
            aria-selected={tab === tb.id}
            onClick={() => setTab(tb.id)}
            className={cx(
              'inline-flex min-h-tap items-center justify-center gap-1.5 rounded-lg text-sm font-semibold',
              tab === tb.id ? 'bg-surface shadow-card' : 'text-muted',
            )}
          >
            <tb.icon className="h-4 w-4" aria-hidden />
            {tb.label}
          </button>
        ))}
      </div>

      {tab === 'text' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) check.mutate({ kind: 'text' });
          }}
          className="space-y-3"
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder={t('scamPlaceholder')}
            aria-label={t('scamPlaceholder')}
            className="w-full rounded-card border-2 border-line-strong bg-surface p-4 text-lg"
          />
          <Button type="submit" size="xl" block loading={check.isPending} disabled={!text.trim() || !online}>
            {check.isPending ? t('checking') : t('checkMessage')}
          </Button>
        </form>
      )}

      {tab === 'image' && (
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) check.mutate({ kind: 'image', blob: f });
              e.target.value = '';
            }}
          />
          <Button size="xl" block variant="secondary" loading={check.isPending} icon={<ImageUp className="h-7 w-7" aria-hidden />} onClick={() => fileRef.current?.click()} disabled={!online}>
            {t('uploadScreenshot')}
          </Button>
        </div>
      )}

      {tab === 'voice' && (
        <Button
          size="xl"
          block
          variant={recording ? 'danger' : 'secondary'}
          loading={check.isPending}
          disabled={!online || (!speechRecognitionSupported() && typeof MediaRecorder === 'undefined')}
          icon={recording ? <Square className="h-7 w-7" aria-hidden /> : <Mic className="h-7 w-7" aria-hidden />}
          onClick={() => {
            if (recording) {
              stopListen.current?.();
              recRef.current?.stop();
              setRecording(false);
            } else void startRec();
          }}
        >
          {recording ? t('recording') : t('speak')}
        </Button>
      )}
      {tab === 'voice' && recording && (
        <p aria-live="polite" className="text-center text-lg text-muted">
          {heard || (lang === 'ur' ? 'پیغام پڑھ کر سنائیں…' : 'Read the message aloud…')}
        </p>
      )}

      {check.error && (
        <p role="alert" className="rounded-control bg-danger-soft p-3 font-medium text-danger">
          {pick((check.error as ApiError).messageUr, check.error.message)}
        </p>
      )}

      {result && v && (
        <section aria-live="polite" className={cx('space-y-4 rounded-card border-2 p-5 animate-rise', v.tone)}>
          <div className="flex items-start gap-4">
            <span className={cx('inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl', v.solid)}>
              <v.icon className="h-9 w-9" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-2xl font-bold leading-snug">{t(v.label)}</h2>
              <p className="num text-sm text-muted">
                {t('confidence')}: {Math.round(result.confidence * 100)}%
              </p>
            </div>
            <AudioButton clip={v.clip} text={`${t(v.label)}. ${pick(result.explanation_ur, result.explanation_en)}. ${pick(result.advice_ur, result.advice_en)}`} />
          </div>
          <p className="text-lg">{pick(result.explanation_ur, result.explanation_en)}</p>

          {result.matched_official && (
            <div className="rounded-control bg-surface p-3">
              <p className="text-sm text-muted">{t('matchedOfficial')}</p>
              <p className="font-semibold">
                <span className="num font-mono text-brand">{result.matched_official.verification_code}</span>
                {result.matched_official.program ? ` · ${result.matched_official.program}` : ''} · <span className="num">{formatDateTime(result.matched_official.sent_at, lang)}</span>
              </p>
            </div>
          )}

          {result.red_flags.length > 0 && (
            <div>
              <h3 className="mb-2 font-bold">{t('redFlags')}</h3>
              <ul className="space-y-2">
                {result.red_flags.map((f) => (
                  <li key={f.code} className="flex items-start gap-2 rounded-control bg-surface p-3">
                    <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
                    <span className="font-medium">{pick(f.label_ur, f.label_en)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-control bg-surface p-3">
            <h3 className="mb-1 font-bold">{t('advice')}</h3>
            <p>{pick(result.advice_ur, result.advice_en)}</p>
            {result.verdict !== 'VERIFIED_OFFICIAL' && (
              <ul className="mt-2 list-inside list-disc space-y-1 text-muted">
                <li>{t('safetyRule1')}</li>
                <li>{t('safetyRule2')}</li>
                <li>{t('safetyRule3')}</li>
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted">{t('advisoryOnly')}</p>
            {feedbackSent ? (
              <p className="text-sm font-semibold text-ok">{t('feedbackThanks')}</p>
            ) : (
              <Button size="sm" variant="ghost" loading={feedback.isPending} onClick={() => feedback.mutate()} icon={<ThumbsDown className="h-4 w-4" aria-hidden />}>
                {t('thinkWrong')}
              </Button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

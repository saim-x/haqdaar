import { useEffect, useRef, useState } from 'react';
import { api } from '../shared/api/client';
import { errorMessage } from '../shared/api/errors';
import type { ScamCheckResult, ScamVerdict } from '../shared/api/types';
import { AvatarToggleCard } from '../shared/avatar/AvatarToggleCard';
import type { AvatarMood } from '../shared/avatar/types';
import { useAvatarGuide } from '../shared/avatar/useAvatarGuide';
import { useAuth } from '../shared/auth/AuthProvider';
import { useVoiceCapture } from '../shared/audio/useVoiceCapture';
import { useI18n } from '../shared/i18n/I18nProvider';
import { stamp } from '../shared/lib/dates';
import { AudioButton } from '../shared/ui/AudioButton';
import { CopyCode } from '../shared/ui/CopyCode';
import { ScreenHeader } from '../shared/ui/ScreenHeader';
import { PublicHeader } from '../shared/ui/PublicHeader';
import { TapButton } from '../shared/ui/TapButton';
import {
  IconCamera,
  IconCheck,
  IconCross,
  IconMic,
  IconPlay,
  IconQuestion,
  IconShield,
  IconWarning,
} from '../shared/ui/Icons';

type Tab = 'text' | 'image' | 'voice';

/**
 * The verdict is the one moment of colour on this screen, so it is allowed to be
 * a full-strength semantic band. Everything around it stays quiet.
 */
const VERDICT: Record<
  ScamVerdict,
  { band: string; Icon: typeof IconCheck; key: `scam.verdict.${ScamVerdict}` }
> = {
  VERIFIED_OFFICIAL: { band: 'bg-positive', Icon: IconCheck, key: 'scam.verdict.VERIFIED_OFFICIAL' },
  LIKELY_SAFE: { band: 'bg-positive', Icon: IconShield, key: 'scam.verdict.LIKELY_SAFE' },
  CANNOT_TELL: { band: 'bg-warn', Icon: IconQuestion, key: 'scam.verdict.CANNOT_TELL' },
  LIKELY_SCAM: { band: 'bg-negative', Icon: IconWarning, key: 'scam.verdict.LIKELY_SCAM' },
};

const SAMPLE_MESSAGES = [
  {
    label: ['Scam: extra fee request', 'فراڈ: اضافی فیس مانگنا', 'فريب: وڌيڪ فيس گهرڻ'],
    text: [
      'MOCK SAMPLE: Your 15,000 relief grant is approved. Pay an extra 500 processing fee today to release the money.',
      'نمونہ پیغام: آپ کی 15,000 روپے امداد منظور ہو گئی۔ رقم جاری کروانے کے لیے آج مزید 500 روپے فیس دیں۔',
      'نموني پيغام: توهان جي 15,000 رپين جي امداد منظور ٿي. رقم وٺڻ لاءِ اڄ وڌيڪ 500 رپيا فيس ڏيو.',
    ],
  },
  {
    label: ['Grant update with a condition', 'رقم کی اطلاع اور شرط', 'امداد جي خبر ۽ شرط'],
    text: [
      'MOCK SAMPLE: Your 15,000 relief payment is being processed. If it does not arrive by Friday, call the number in this message. No fee is required.',
      'نمونہ پیغام: آپ کی 15,000 روپے کی امداد زیرِ عمل ہے۔ اگر جمعہ تک نہ آئے تو اس پیغام میں دیے گئے نمبر پر فون کریں۔ کوئی فیس نہیں۔',
      'نموني پيغام: توهان جي 15,000 رپين جي امداد تيار ٿي رهي آهي. جمعي تائين نه اچي ته هن پيغام واري نمبر تي فون ڪريو. ڪا فيس ناهي.',
    ],
  },
  {
    label: ['Payment failed, retry requested', 'ادائیگی ناکام، دوبارہ کوشش', 'ادائيگي ناڪام، ٻيهر ڪوشش'],
    text: [
      'MOCK SAMPLE: Your relief payment could not be delivered. Reply with your account number so we can retry it. There is no charge.',
      'نمونہ پیغام: آپ کی امدادی رقم نہیں پہنچ سکی۔ دوبارہ بھیجنے کے لیے اپنا اکاؤنٹ نمبر جواب میں بھیجیں۔ کوئی فیس نہیں۔',
      'نموني پيغام: توهان جي امدادي رقم نه پهتي. ٻيهر موڪلڻ لاءِ پنهنجو اڪائونٽ نمبر جواب ۾ موڪليو. ڪا فيس ناهي.',
    ],
  },
  {
    label: ['Safety reminder with a link', 'حفاظتی پیغام اور لنک', 'حفاظتي پيغام ۽ لنڪ'],
    text: [
      'MOCK SAMPLE: Haqdaar will never ask for your PIN or a fee. Check your application status in the app. If this was not you, review your account here: haqdaar.example/check',
      'نمونہ پیغام: حق دار کبھی آپ کا PIN یا فیس نہیں مانگتا۔ ایپ میں درخواست کی حالت دیکھیں۔ اگر یہ آپ نے نہیں کیا تو یہاں اکاؤنٹ دیکھیں: haqdaar.example/check',
      'نموني پيغام: حق دار ڪڏهن به PIN يا فيس نه گهرندو. ايپ ۾ درخواست جي حالت ڏسو. جيڪڏهن هي ڪم توهان نه ڪيو ته هتي اڪائونٽ ڏسو: haqdaar.example/check',
    ],
  },
] as const;

/**
 * The guide's tone for a verdict. `warning` for a scam and `not_sure` for
 * `CANNOT_TELL` are the two that matter: the first is a shield, the second is an
 * honest shrug, and neither is allowed to look like the other.
 */
function moodForVerdict(verdict: ScamVerdict): AvatarMood {
  if (verdict === 'LIKELY_SCAM') return 'warning';
  if (verdict === 'VERIFIED_OFFICIAL') return 'happy';
  if (verdict === 'CANNOT_TELL') return 'not_sure';
  return 'calm';
}

/**
 * Scam checker - docs/11 §3.4, F-14.
 * Public: no login. Advisory only - it never blocks or deletes anything (AC-14.5).
 *
 * All three input tabs are real: `POST /scam/check` takes JSON text, a
 * screenshot as `image`, or a voice note as `audio`. The voice tab used to be a
 * disabled button promising a future feature; it now records and uploads.
 */
export function ScamCheckPage() {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<Tab>('text');
  const [text, setText] = useState('');
  const [showSamples, setShowSamples] = useState(false);
  const [result, setResult] = useState<ScamCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disputed, setDisputed] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const capture = useVoiceCapture(20);
  const { session } = useAuth();
  const guide = useAvatarGuide('scam_check');
  // The public route stays audio-only on purpose: an anonymous visitor must not
  // be able to spend the deployment's video minutes, and there is no account to
  // rate-limit against.
  const canGuide = Boolean(session && ['CITIZEN', 'HELPER'].includes(session.user.role));

  async function check(payload: { text?: string; image?: File; audio?: Blob }) {
    setBusy(true);
    setError(null);
    setResult(null);
    setDisputed(false);
    try {
      if (payload.image || payload.audio) {
        const form = new FormData();
        if (payload.image) form.append('image', payload.image);
        if (payload.audio) form.append('audio', payload.audio, 'message.webm');
        setResult(await api.upload<ScamCheckResult>('/scam/check', form, { anonymous: true }));
      } else {
        setResult(
          await api.post<ScamCheckResult>(
            '/scam/check',
            { text: payload.text ?? '', district: null },
            { anonymous: true },
          ),
        );
      }
    } catch (err) {
      setError(errorMessage(err, lang));
    } finally {
      setBusy(false);
    }
  }

  // The recorder hands the blob back after `stop()`; upload it once.
  const readyBlob = capture.state === 'ready' ? capture.blob : null;
  useEffect(() => {
    if (readyBlob) void check({ audio: readyBlob });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyBlob]);

  async function dispute() {
    if (!result) return;
    try {
      await api.post(`/scam/${result.check_id}/feedback`, { disputed: true, note: null }, { anonymous: true });
      setDisputed(true);
    } catch {
      setDisputed(true);
    }
  }

  const verdict = result ? VERDICT[result.verdict] : null;

  // Assembled from the verdict the model already produced - the guide explains,
  // it never re-scores. Zero extra model calls.
  const guideBriefing = result
    ? [
        t(VERDICT[result.verdict].key),
        lang !== 'en' ? result.explanation_ur : result.explanation_en,
        ...result.red_flags.slice(0, 3).map((flag) => (lang !== 'en' ? flag.label_ur : flag.label_en)),
        lang !== 'en' ? result.advice_ur : result.advice_en,
      ]
        .filter(Boolean)
        .join('۔ ')
    : '';
  const guideMood: AvatarMood = result ? moodForVerdict(result.verdict) : 'calm';
  const recording = capture.state === 'recording';
  const micBlocked = capture.state === 'unsupported' || capture.state === 'denied';

  const tabs: [Tab, string, typeof IconShield][] = [
    ['text', t('scam.tabText'), IconShield],
    ['image', t('scam.tabImage'), IconCamera],
    ['voice', t('scam.tabVoice'), IconMic],
  ];

  return (
    <>
      <PublicHeader />
      <div className="screen px-4 sm:px-6">
        <ScreenHeader
          title={t('scam.title')}
          hint={t('scam.subtitle')}
          audioKey="scam_intro"
          audioText={t('scam.subtitle')}
        />

        {/* Segmented control: the active segment is a raised surface, not a filled
            accent block, so the verdict band below stays the loudest thing. */}
        <div data-tour="scam-input" className="enter enter-2 mb-5 grid grid-cols-3 gap-1 rounded-control bg-raised p-1" role="tablist">
          {tabs.map(([key, label, Icon]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`press flex min-h-tap flex-col items-center justify-center gap-1 rounded-[7px] px-1 text-meta font-medium ${
                tab === key ? 'bg-card text-ink shadow-hair' : 'text-ink-3 hover:text-ink-2'
              }`}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-control border border-negative/25 bg-negative-wash px-4 py-3 text-caption font-medium text-negative"
          >
            {error}
          </div>
        )}

        {tab === 'text' && (
          <section className="card enter enter-3 p-5">
            <div className="mb-3">
              <button type="button" aria-expanded={showSamples} onClick={() => setShowSamples(!showSamples)}
                className="press min-h-tap rounded-control border border-ink/[0.12] bg-raised px-3 text-meta font-medium text-ink-2 hover:bg-card">
                {lang === 'en' ? 'Demo messages' : lang === 'sd' ? 'ڊيمو پيغام' : 'نمونہ پیغامات'}
              </button>
              {showSamples && <div className="mt-2 flex flex-wrap gap-2">
                {SAMPLE_MESSAGES.map((sample) => (
                  <button key={sample.label[0]} type="button" disabled={busy}
                    onClick={() => setText(sample.text[lang === 'en' ? 0 : lang === 'sd' ? 2 : 1])}
                    className="press min-h-tap rounded-control border border-ink/[0.12] bg-raised px-3 text-meta font-medium text-ink-2 hover:bg-card disabled:opacity-50">
                    {sample.label[lang === 'en' ? 0 : lang === 'sd' ? 2 : 1]}
                  </button>
                ))}
              </div>}
            </div>
            <textarea
              id="scam-text"
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('scam.placeholder')}
              aria-label={t('scam.tabText')}
            />
            <TapButton
              block
              className="mt-3"
              onClick={() => void check({ text })}
              disabled={busy || text.trim().length === 0}
            >
              {busy ? t('common.loading') : t('scam.check')}
            </TapButton>
          </section>
        )}

        {tab === 'image' && (
          <section className="card enter enter-3 p-5">
            <p className="mb-3 text-caption leading-[1.7] text-ink-2">{t('scam.imageHint')}</p>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void check({ image: file });
              }}
            />
            <TapButton block onClick={() => fileRef.current?.click()} disabled={busy} icon={<IconCamera size={18} />}>
              {busy ? t('common.loading') : t('scam.tabImage')}
            </TapButton>
          </section>
        )}

        {tab === 'voice' && (
          <section className="card enter enter-3 p-5">
            <p className="mb-3 text-caption leading-[1.7] text-ink-2">{t('scam.voiceHint')}</p>
            {micBlocked ? (
              <p className="rounded-control bg-raised px-3 py-2.5 text-meta leading-[1.7] text-ink-2">
                {t('scam.voiceUnavailable')}
              </p>
            ) : (
              <TapButton
                block
                variant={recording ? 'danger' : 'primary'}
                onClick={() => (recording ? capture.stop() : void capture.start())}
                disabled={busy}
                icon={<IconMic size={18} />}
              >
                {recording
                  ? `${t('helper.recording')} ${capture.seconds}s`
                  : busy
                    ? t('common.loading')
                    : t('scam.record')}
              </TapButton>
            )}
          </section>
        )}

        {result && verdict && (
          <section className="card enter enter-4 mt-5 overflow-hidden">
            <div className={`flex items-center gap-3 p-5 text-white ${verdict.band}`}>
              <verdict.Icon size={32} />
              <div className="min-w-0 flex-1">
                <p className="text-title font-medium leading-[1.3]">{t(verdict.key)}</p>
                <p className="num mt-0.5 font-mono text-meta text-white/80">
                  {Math.round(result.confidence * 100)}%
                </p>
              </div>
              <AudioButton
                tone="onDark"
                audioKey={`scam_${result.verdict.toLowerCase()}`}
                text={lang === 'ur' ? result.explanation_ur : result.explanation_en}
              />
            </div>

            <div className="p-5">
              {canGuide &&
                (guide.active ? (
                  <AvatarToggleCard guide={guide} className="mb-4" />
                ) : (
                  guide.available &&
                  !guide.steppedDown && (
                    <button
                      type="button"
                      onClick={() => {
                        guide.start();
                        guide.speak({ text: guideBriefing, caption: guideBriefing, mood: guideMood });
                      }}
                      data-testid="avatar-explain-verdict"
                      className="press mb-4 flex min-h-primary w-full items-center gap-2.5 rounded-control border border-accent/30 bg-accent-wash px-3.5 text-start text-body font-medium text-accent-ink hover:bg-accent/15"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-white">
                        <IconPlay size={16} />
                      </span>
                      {t('avatar.explainVerdict')}
                    </button>
                  )
                ))}

              {/* Visual calibrated risk band gauge so citizens & judges see the honest CANNOT_TELL band. */}
              {result.verdict !== 'VERIFIED_OFFICIAL' && (
                <div className="mb-4 rounded-control border border-ink/[0.08] bg-raised/60 px-3 py-2.5">
                  <div className="flex items-center justify-between text-meta text-ink-3">
                    <span>{lang === 'en' ? 'Calibrated Risk Band' : 'خطرے کا پیمانہ'}</span>
                    <span className="num font-mono text-ink-2">
                      {Math.round(result.confidence * 100)}%
                    </span>
                  </div>
                  <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-ink/[0.08]">
                    <div className="absolute inset-y-0 left-0 w-[35%] bg-positive/35" />
                    <div className="absolute inset-y-0 left-[35%] w-[40%] bg-warn/35" />
                    <div className="absolute inset-y-0 left-[75%] w-[25%] bg-negative/40" />
                    <div
                      className="absolute top-0 h-2 w-1.5 -translate-x-1/2 rounded-full bg-ink"
                      style={{
                        left: `${Math.min(
                          98,
                          Math.max(
                            2,
                            result.verdict === 'LIKELY_SCAM'
                              ? Math.max(76, Math.round(result.confidence * 100))
                              : result.verdict === 'LIKELY_SAFE'
                                ? Math.min(34, Math.round((1 - result.confidence) * 100))
                                : 55,
                          ),
                        )}%`,
                      }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-ink-3">
                    <span>{lang === 'en' ? 'Safe (<35%)' : 'محفوظ'}</span>
                    <span>{lang === 'en' ? 'Cannot tell (35–75%)' : 'یقین نہیں'}</span>
                    <span>{lang === 'en' ? 'Likely scam (>75%)' : 'جعلی'}</span>
                  </div>
                </div>
              )}

              <p className="text-body leading-[1.7] text-ink">
                {lang !== 'en' ? result.explanation_ur : result.explanation_en}
              </p>

              {result.matched_official && (
                <div className="mt-4 border-t border-ink/[0.08] pt-4">
                  <p className="text-meta text-ink-3">{t('scam.matchedCode')}</p>
                  <div className="mt-1.5">
                    <CopyCode value={result.matched_official.verification_code} tone="green" size="md" />
                  </div>
                  <p className="mt-1.5 text-meta text-ink-3">
                    {(lang !== 'en'
                      ? (result.matched_official as { title_ur?: string; program?: string }).title_ur
                      : (result.matched_official as { title_en?: string; program?: string }).title_en) ||
                      result.matched_official.program ||
                      t('app.tagline')}{' '}
                    · <bdi className="tabular-nums">{stamp(result.matched_official.created_at, lang)}</bdi>
                  </p>
                </div>
              )}

              {result.red_flags.length > 0 && (
                <div className="mt-4 border-t border-ink/[0.08] pt-4">
                  <p className="mb-2 text-meta text-ink-3">{t('scam.redFlags')}</p>
                  <ul className="space-y-1.5">
                    {result.red_flags.map((flag) => (
                      <li key={flag.code} className="flex items-start gap-2">
                        <IconCross size={14} className="mt-1 shrink-0 text-negative" />
                        <span className="text-caption leading-[1.7] text-ink">
                          {lang !== 'en' ? flag.label_ur : flag.label_en}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4 flex items-center gap-2 rounded-control bg-warn-wash px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-meta text-warn">{t('scam.advice')}</p>
                  <p className="mt-0.5 text-caption leading-[1.7] text-ink">
                    {lang !== 'en' ? result.advice_ur : result.advice_en}
                  </p>
                </div>
                <AudioButton
                  text={lang !== 'en' ? result.advice_ur : result.advice_en}
                  label={`${t('common.listen')} · ${t('scam.advice')}`}
                  variant="quiet"
                />
              </div>

              <button
                type="button"
                onClick={() => void dispute()}
                disabled={disputed}
                className="press mt-4 min-h-tap w-full rounded-control text-meta font-medium text-ink-3 underline decoration-1 underline-offset-4 hover:text-ink disabled:no-underline disabled:opacity-60"
              >
                {disputed ? t('scam.disputeThanks') : t('scam.dispute')}
              </button>
            </div>
          </section>
        )}

        {/* The never-share rule is true before you check and after, so it lives in
            the page chrome rather than inside one result. */}
        <p className="enter enter-5 mt-6 flex items-start gap-2 text-meta leading-[1.7] text-ink-3">
          <IconShield size={14} className="mt-0.5 shrink-0" />
          {t('scam.neverShare')}
        </p>
      </div>
    </>
  );
}

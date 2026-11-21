import { useRef, useState } from 'react';
import { api } from '../shared/api/client';
import { errorMessage } from '../shared/api/errors';
import type { ScamCheckResult, ScamVerdict } from '../shared/api/types';
import { useI18n } from '../shared/i18n/I18nProvider';
import { AudioButton } from '../shared/ui/AudioButton';
import { CopyCode } from '../shared/ui/CopyCode';
import { TapButton } from '../shared/ui/TapButton';
import { IconCamera, IconCheck, IconCross, IconMic, IconQuestion, IconShield, IconWarning } from '../shared/ui/Icons';
import { DashboardBackLink } from './DashboardBackLink';

type Tab = 'text' | 'image' | 'voice';

const VERDICT_STYLE: Record<ScamVerdict, { bg: string; ring: string; Icon: typeof IconCheck; key: `scam.verdict.${ScamVerdict}` }> = {
  VERIFIED_OFFICIAL: { bg: 'bg-[#0F7B3F]', ring: 'ring-[#0F7B3F]/30', Icon: IconCheck, key: 'scam.verdict.VERIFIED_OFFICIAL' },
  LIKELY_SAFE: { bg: 'bg-[#0F7B3F]', ring: 'ring-[#0F7B3F]/30', Icon: IconShield, key: 'scam.verdict.LIKELY_SAFE' },
  CANNOT_TELL: { bg: 'bg-amber-400', ring: 'ring-amber-400/40', Icon: IconQuestion, key: 'scam.verdict.CANNOT_TELL' },
  LIKELY_SCAM: { bg: 'bg-[#B42318]', ring: 'ring-[#B42318]/30', Icon: IconWarning, key: 'scam.verdict.LIKELY_SCAM' },
};

/**
 * Scam checker — docs/11 §3.4, F-14.
 * Public: no login. Advisory only — it never blocks or deletes anything (AC-14.5).
 */
export function ScamCheckPage() {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<Tab>('text');
  const [text, setText] = useState('');
  const [result, setResult] = useState<ScamCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disputed, setDisputed] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function check(payload: { text?: string; file?: File }) {
    setBusy(true);
    setError(null);
    setResult(null);
    setDisputed(false);
    try {
      if (payload.file) {
        const form = new FormData();
        form.append('image', payload.file);
        const res = await api.upload<ScamCheckResult>('/scam/check', form, { anonymous: true });
        setResult(res);
      } else {
        const res = await api.post<ScamCheckResult>(
          '/scam/check',
          { text: payload.text ?? '', district: null },
          { anonymous: true },
        );
        setResult(res);
      }
    } catch (err) {
      setError(errorMessage(err, lang));
    } finally {
      setBusy(false);
    }
  }

  async function dispute() {
    if (!result) return;
    try {
      await api.post(`/scam/${result.check_id}/feedback`, { disputed: true, note: null }, { anonymous: true });
      setDisputed(true);
    } catch {
      setDisputed(true);
    }
  }

  const style = result ? VERDICT_STYLE[result.verdict] : null;

  return (
    <div className="screen">
      <DashboardBackLink />
      <header className="mb-4 mt-1 flex items-start justify-between gap-3">
        <div>
          <h1 className="screen-title">{t('scam.title')}</h1>
          <p className="screen-hint">{t('scam.subtitle')}</p>
        </div>
        <AudioButton audioKey="scam_intro" text={t('scam.subtitle')} />
      </header>

      <div className="mb-4 grid grid-cols-3 gap-2" role="tablist">
        {(
          [
            ['text', t('scam.tabText'), IconShield],
            ['image', t('scam.tabImage'), IconCamera],
            ['voice', t('scam.tabVoice'), IconMic],
          ] as [Tab, string, typeof IconShield][]
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex min-h-primary flex-col items-center justify-center gap-1 rounded-2xl border-2 px-1 text-[11px] font-semibold ${
              tab === key ? 'border-teal-700 bg-teal-600 text-white' : 'border-ink/20 bg-white text-ink'
            }`}
          >
            <Icon size={20} />
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="mb-3 rounded-2xl border-2 border-[#B42318]/40 bg-[#B42318]/10 px-4 py-3 text-sm font-semibold text-[#B42318]">
          {error}
        </div>
      )}

      {tab === 'text' && (
        <section className="card p-4">
          <label htmlFor="scam-text" className="mb-1 block text-sm font-semibold text-ink-soft">
            {t('scam.tabText')}
          </label>
          <textarea
            id="scam-text"
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('scam.placeholder')}
            className="text-base"
          />
          <TapButton block className="mt-3" onClick={() => void check({ text })} disabled={busy || text.trim().length === 0}>
            {busy ? t('common.loading') : t('scam.check')}
          </TapButton>
        </section>
      )}

      {tab === 'image' && (
        <section className="card p-4">
          <p className="mb-2 text-sm text-ink-soft">{t('scam.tabImage')}</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void check({ file });
            }}
          />
          <TapButton block onClick={() => fileRef.current?.click()} disabled={busy} icon={<IconCamera size={20} />}>
            {busy ? t('common.loading') : t('scam.tabImage')}
          </TapButton>
        </section>
      )}

      {tab === 'voice' && (
        <section className="card p-4">
          <p className="mb-2 text-sm text-ink-soft">
            {lang === 'ur'
              ? 'پیغام بولیں۔ ہم اسے سن کر جانیں گے۔'
              : 'Speak the message. We will listen and check it.'}
          </p>
          <TapButton block disabled icon={<IconMic size={20} />}>
            {t('scam.tabVoice')}
          </TapButton>
          <p className="mt-2 text-[11px] text-ink-soft">
            {lang === 'ur' ? 'آواز کی سہولت جلد آ رہی ہے۔ ابھی پیغام لکھیں۔' : 'Voice input is coming next. Paste the text for now.'}
          </p>
        </section>
      )}

      {result && style && (
        <section className={`card mt-4 overflow-hidden p-0 ring-4 ${style.ring}`}>
          <div className={`flex items-center gap-3 p-4 text-white ${style.bg}`}>
            <style.Icon size={40} />
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold leading-tight">{t(style.key)}</p>
              <p className="num text-xs opacity-90">{Math.round(result.confidence * 100)}%</p>
            </div>
            <AudioButton
              audioKey={`scam_${result.verdict.toLowerCase()}`}
              text={lang === 'ur' ? result.explanation_ur : result.explanation_en}
              className="border-white bg-white/15 text-white"
            />
          </div>

          <div className="p-4">
            <p className="text-sm leading-relaxed text-ink">
              {lang === 'ur' ? result.explanation_ur : result.explanation_en}
            </p>

            {result.matched_official && (
              <div className="mt-3 rounded-xl bg-[#0F7B3F]/10 px-3 py-2">
                <p className="text-[11px] font-bold uppercase text-[#0F7B3F]">{t('scam.matchedCode')}</p>
                <div className="mt-1">
                  <CopyCode value={result.matched_official.verification_code} tone="green" size="md" />
                </div>
                <p className="mt-1 text-[11px] text-ink-soft">
                  {result.matched_official.program} ·{' '}
                  <span className="num">{new Date(result.matched_official.created_at).toLocaleString()}</span>
                </p>
              </div>
            )}

            {result.red_flags.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-[11px] font-bold uppercase text-[#B42318]">{t('scam.redFlags')}</p>
                <ul className="space-y-1">
                  {result.red_flags.map((flag) => (
                    <li key={flag.code} className="flex items-start gap-1.5 text-sm text-ink">
                      <IconCross size={16} className="mt-0.5 shrink-0 text-[#B42318]" />
                      <span>{lang === 'ur' ? flag.label_ur : flag.label_en}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2">
              <p className="text-[11px] font-bold uppercase text-amber-700">{t('scam.advice')}</p>
              <p className="text-sm text-[#3B2A00]">{lang === 'ur' ? result.advice_ur : result.advice_en}</p>
              <p className="mt-1 text-[11px] font-semibold text-amber-700">{t('scam.neverShare')}</p>
            </div>

            <button
              type="button"
              onClick={() => void dispute()}
              disabled={disputed}
              className="mt-3 min-h-tap w-full rounded-xl border-2 border-ink/15 text-xs font-semibold text-ink-soft disabled:opacity-60"
            >
              {disputed ? t('scam.disputeThanks') : t('scam.dispute')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

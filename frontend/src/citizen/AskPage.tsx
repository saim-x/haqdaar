import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../shared/api/client';
import { errorMessage } from '../shared/api/errors';
import type { RagAnswer } from '../shared/api/types';
import { AvatarToggleCard } from '../shared/avatar/AvatarToggleCard';
import { detectGuideAction } from '../shared/avatar/intentRouter';
import { useAvatarGuide } from '../shared/avatar/useAvatarGuide';
import type { GuideAction } from '../shared/avatar/types';
import { useVoiceCapture } from '../shared/audio/useVoiceCapture';
import { useI18n } from '../shared/i18n/I18nProvider';
import { AudioButton } from '../shared/ui/AudioButton';
import { ScreenHeader } from '../shared/ui/ScreenHeader';
import { TapButton } from '../shared/ui/TapButton';
import {
  IconArrowRight,
  IconChevron,
  IconDocument,
  IconList,
  IconMic,
  IconShield,
  IconUsers,
  IconWarning,
} from '../shared/ui/Icons';

interface Turn {
  id: number;
  question: string;
  answer: RagAnswer | null;
  error: string | null;
}

const SUGGESTIONS_UR = ['میں درخواست کیسے دوں؟', 'رقم کب ملے گی؟', 'شناختی کارڈ نہیں ہے تو کیا کروں؟'];
const SUGGESTIONS_SD = ['مان درخواست ڪيئن ڏيان؟', 'رقم ڪڏهن ملندي؟', 'جيڪڏهن سڃاڻپ ڪارڊ ناهي ته ڇا ڪريان؟'];
const SUGGESTIONS_EN = ['How do I apply?', 'When will I get the money?', 'What if I do not have a CNIC?'];

/** The guided-action chip's glyph, keyed by the intent the router detected. */
const ACTION_ICON: Record<GuideAction['icon'], typeof IconDocument> = {
  document: IconDocument,
  list: IconList,
  shield: IconShield,
  warning: IconWarning,
  user: IconUsers,
};

export function AskPage() {
  const { t, lang, isRtl } = useI18n();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const nextId = useRef(1);
  const capture = useVoiceCapture(15);
  const guide = useAvatarGuide('ask');
  const greetedRef = useRef(false);
  // The last question this page already put in the log. A spoken question arrives
  // back from the vendor as a turn, and must not be logged twice.
  const lastAskedRef = useRef('');
  const askRef = useRef<(text: string) => void>(() => undefined);

  // Opening the guide is the citizen's tap; greeting her is the guide's first
  // act, and it reuses the clip this screen already ships - no extra TTS call.
  useEffect(() => {
    if (!guide.active) {
      greetedRef.current = false;
      return;
    }
    if (greetedRef.current) return;
    greetedRef.current = true;
    // In two-way mode the greeting is spoken by the vendor, so it must be a real
    // sentence rather than the page title. In every other mode the pre-cached
    // clip is used, which costs no TTS call at all.
    guide.speak(
      guide.conversational
        ? { text: t('avatar.greeting'), mood: 'listening' }
        : { text: t('ask.title'), mood: 'listening', clipKey: 'ask_intro' },
    );
  }, [guide.active, guide.conversational, guide.speak, t]);

  // A question the citizen asked out loud never passes through the composer, so
  // the vendor's own transcript is the only record of it. Feeding it back through
  // `ask` gives a spoken question exactly the same grounded citations as a typed
  // one - and the guided-action chip appears the moment she says what she wants.
  useEffect(() => {
    guide._registerTurn((turn) => {
      if (turn.role !== 'user') return;
      const text = turn.content.trim();
      if (!text || text === lastAskedRef.current) return;
      lastAskedRef.current = text;
      askRef.current(text);
    });
    return () => guide._registerTurn(null);
  }, [guide]);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    lastAskedRef.current = trimmed;
    const id = nextId.current++;
    setTurns((prev) => [...prev, { id, question: trimmed, answer: null, error: null }]);
    setQuestion('');
    setBusy(true);
    // Two-way mode: Saima answers out loud in her own words, grounded by the
    // system prompt the backend built from the live rule version. The `/rag/ask`
    // call below runs in parallel and supplies the verifiable citation chip, so
    // the citizen gets both a conversation and a receipt.
    if (guide.active && guide.conversational) guide.sendUserMessage(trimmed);
    try {
      const answer = await api.post<RagAnswer>('/rag/ask', {
        question: trimmed,
        program_id: null,
        lang: isRtl ? 'ur' : 'en',
        // ADR-025: only ask for the warm spoken reframing while the guide is
        // open. The verbatim `answer` and its citations are unchanged either way.
        ...(guide.active ? { conversational: true } : {}),
      });
      setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, answer } : turn)));
      // In two-way mode Saima has already answered in her own voice; speaking the
      // verbatim text as well would make her say everything twice. The evidence
      // chips still have to land, though - they are the checkable half of the
      // answer, and they come from `/rag/ask`, not from the vendor.
      const first = answer.citations[0];
      const citation = first ? `${first.doc_title} · ${first.section}` : null;
      if (guide.active && guide.conversational) {
        guide.setEvidence({ citation, notSure: answer.status === 'NOT_SURE' });
      } else if (guide.active) {
        const spoken = answer.spoken_summary || answer.answer;
        guide.speak({
          text: spoken,
          caption: spoken,
          mood: answer.status === 'NOT_SURE' ? 'not_sure' : 'happy',
          notSure: answer.status === 'NOT_SURE',
          citation: citation ?? undefined,
        });
      }
    } catch (err) {
      setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, error: errorMessage(err, lang) } : turn)));
    } finally {
      setBusy(false);
    }
  }

  askRef.current = (text: string) => void ask(text);

  const readyBlob = capture.state === 'ready' ? capture.blob : null;
  useEffect(() => {
    if (!readyBlob) return;
    let cancelled = false;
    setTranscribing(true);
    const form = new FormData();
    form.append('audio', readyBlob, 'question.webm');
    api
      .upload<{ transcript: string; available: boolean }>('/rag/transcribe', form)
      .then((res) => {
        if (cancelled) return;
        capture.reset();
        if (res.transcript?.trim()) {
          void ask(res.transcript.trim());
        }
      })
      .catch(() => {
        if (!cancelled) capture.reset();
      })
      .finally(() => {
        if (!cancelled) setTranscribing(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyBlob]);

  const suggestions = lang === 'sd' ? SUGGESTIONS_SD : lang === 'ur' ? SUGGESTIONS_UR : SUGGESTIONS_EN;
  const recording = capture.state === 'recording';
  const micAvailable = capture.state !== 'unsupported' && capture.state !== 'denied';

  return (
    <div className="screen flex min-h-[calc(100dvh-var(--banner-h))] flex-col">
      <ScreenHeader
        title={t('ask.title')}
        hint={t('ask.hint')}
        audioKey="ask_intro"
        audioText={t('ask.title')}
      />

      <div className="flex-1">
        {turns.length === 0 && (
          <section className="enter enter-2">
            <h2 className="section-label mb-3">{t('ask.pick')}</h2>
            <ul className="border-y border-ink/[0.08]">
              {suggestions.map((s) => (
                <li key={s} className="border-b border-ink/[0.08] last:border-b-0">
                  <button
                    type="button"
                    onClick={() => void ask(s)}
                    className="press flex min-h-primary w-full items-center gap-2.5 px-1 py-3 text-start hover:bg-raised/50"
                  >
                    <span className="flex-1 text-body text-ink">{s}</span>
                    <IconChevron size={16} className="shrink-0 text-ink-3" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="space-y-5">
          {turns.map((turn) => (
            <div key={turn.id} className="enter space-y-2.5">
              <p className="ms-auto max-w-[85%] rounded-control rounded-ee-[4px] bg-raised px-3.5 py-2.5 text-body leading-[1.6] text-ink">
                {turn.question}
              </p>

              {turn.error && (
                <div
                  role="alert"
                  className="rounded-control border border-negative/25 bg-negative-wash px-3.5 py-2.5 text-caption font-medium text-negative"
                >
                  {turn.error}
                </div>
              )}

              {!turn.answer && !turn.error && (
                <p className="max-w-[90%] text-caption text-ink-3" role="status">
                  {t('common.loading')}
                </p>
              )}

              {turn.answer && (
                <div className="card max-w-[92%] p-4">
                  <div className="flex items-start gap-2.5">
                    <p className="flex-1 text-body leading-[1.7] text-ink">{turn.answer.answer}</p>
                    <AudioButton audioKey={null} text={turn.answer.answer} />
                  </div>

                  {turn.answer.status === 'NOT_SURE' && (
                    <div className="mt-3 flex items-start gap-2 rounded-control bg-warn-wash px-3 py-2.5">
                      <IconShield size={16} className="mt-0.5 shrink-0 text-warn" />
                      <p className="text-caption font-medium leading-[1.7] text-warn">{t('ask.notSure')}</p>
                    </div>
                  )}

                  {turn.answer.citations.length > 0 && (
                    <div className="mt-3 border-t border-ink/[0.08] pt-3">
                      <p className="mb-2 text-meta text-ink-3">{t('ask.citations')}</p>
                      <ul className="space-y-2">
                        {turn.answer.citations.map((citation, index) => (
                          <li key={`${citation.doc_title}-${index}`} className="rounded-control bg-raised/40 p-2.5">
                            <p className="flex items-center gap-1.5 text-meta font-medium text-ink">
                              <IconDocument size={14} className="shrink-0 text-accent-ink" />
                              {citation.doc_title} · {citation.section}
                            </p>
                            <p className="mt-1 text-caption leading-[1.7] text-ink-2">{citation.excerpt}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* The composer belongs at the bottom of the screen, not under the last
          message: answers arrive above it, so it must not move when they do. */}
      <form
        className="sticky bottom-[76px] mt-5 flex items-end gap-1.5 rounded-control border border-ink/[0.08] bg-card p-1.5 shadow-lift"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        {micAvailable && (
          <button
            type="button"
            disabled={busy || transcribing}
            onClick={() => (recording ? capture.stop() : void capture.start())}
            aria-label={recording ? t('wizard.voice.listening') : t('common.speak')}
            title={t('common.speak')}
            className={`press grid h-tap w-tap shrink-0 place-items-center rounded-control border ${
              recording
                ? 'border-negative bg-negative text-white'
                : 'border-ink/[0.12] bg-raised text-accent-ink hover:bg-accent-wash'
            }`}
          >
            <IconMic size={18} />
          </button>
        )}
        <label htmlFor="ask-input" className="sr-only">
          {t('ask.placeholder')}
        </label>
        <textarea
          data-tour="ask-input"
          id="ask-input"
          rows={1}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={
            recording
              ? `${t('wizard.voice.listening')} ${capture.seconds}s`
              : transcribing
                ? t('common.loading')
                : t('ask.placeholder')
          }
          className="min-h-tap flex-1 resize-none border-0 bg-transparent px-2 text-body-lg focus:ring-0"
        />
        <TapButton size="tap" type="submit" disabled={busy || transcribing || question.trim().length === 0}>
          {t('ask.send')}
        </TapButton>
      </form>
    </div>
  );
}

import { useRef, useState } from 'react';
import { api } from '../shared/api/client';
import { errorMessage } from '../shared/api/errors';
import type { RagAnswer } from '../shared/api/types';
import { useI18n } from '../shared/i18n/I18nProvider';
import { AudioButton } from '../shared/ui/AudioButton';
import { ScreenHeader } from '../shared/ui/ScreenHeader';
import { TapButton } from '../shared/ui/TapButton';
import { IconChevron, IconDocument, IconShield } from '../shared/ui/Icons';

interface Turn {
  id: number;
  question: string;
  answer: RagAnswer | null;
  error: string | null;
}

const SUGGESTIONS_UR = ['میں درخواست کیسے دوں؟', 'رقم کب ملے گی؟', 'شناختی کارڈ نہیں ہے تو کیا کروں؟'];

const SUGGESTIONS_EN = ['How do I apply?', 'When will I get the money?', 'What if I do not have a CNIC?'];

/**
 * Ask a question — docs/11 §3.5, F-12.
 *
 * Grounded RAG answers with citations. When the retriever is not confident the
 * answer is an explicit "we are not sure" plus a route to a human — never a guess.
 *
 * The question is a raised block on the end edge and the answer is a card on the
 * start edge, so the two voices read apart without a coloured chat bubble.
 */
export function AskPage() {
  const { t, lang } = useI18n();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const id = nextId.current++;
    setTurns((prev) => [...prev, { id, question: trimmed, answer: null, error: null }]);
    setQuestion('');
    setBusy(true);
    try {
      const answer = await api.post<RagAnswer>('/rag/ask', {
        question: trimmed,
        program_id: null,
        lang,
      });
      setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, answer } : turn)));
    } catch (err) {
      setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, error: errorMessage(err, lang) } : turn)));
    } finally {
      setBusy(false);
    }
  }

  const suggestions = lang === 'ur' ? SUGGESTIONS_UR : SUGGESTIONS_EN;

  return (
    <div className="screen flex min-h-[calc(100dvh-var(--banner-h))] flex-col">
      <ScreenHeader
        title={t('ask.title')}
        hint={lang === 'ur' ? 'اپنا سوال لکھیں یا بولیں' : 'Type or speak your question'}
        audioKey="ask_intro"
        audioText={t('ask.title')}
      />

      <div className="flex-1">
        {turns.length === 0 && (
          <section className="enter enter-2">
            <h2 className="section-label mb-3">{lang === 'ur' ? 'کوئی سوال منتخب کریں' : 'Pick a question'}</h2>
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
                          <li key={`${citation.doc_title}-${index}`}>
                            <p className="flex items-center gap-1.5 text-meta font-medium text-ink">
                              <IconDocument size={13} className="shrink-0 text-ink-3" />
                              {citation.doc_title} · {citation.section}
                            </p>
                            <p className="mt-0.5 text-meta leading-[1.7] text-ink-3">{citation.excerpt}</p>
                            <p className="num mt-0.5 font-mono text-meta text-ink-3">
                              v{citation.version} · {Math.round(citation.score * 100)}%
                            </p>
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
        className="sticky bottom-[76px] mt-5 flex items-end gap-2 rounded-control border border-ink/[0.08] bg-card p-1.5 shadow-lift"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <label htmlFor="ask-input" className="sr-only">
          {t('ask.placeholder')}
        </label>
        <textarea
          id="ask-input"
          rows={1}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t('ask.placeholder')}
          className="min-h-tap flex-1 resize-none border-0 bg-transparent px-2 text-body-lg focus:ring-0"
        />
        <TapButton size="tap" type="submit" disabled={busy || question.trim().length === 0}>
          {t('ask.send')}
        </TapButton>
      </form>
    </div>
  );
}

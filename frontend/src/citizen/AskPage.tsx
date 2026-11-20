import { useRef, useState } from 'react';
import { api } from '../shared/api/client';
import { errorMessage } from '../shared/api/errors';
import type { RagAnswer } from '../shared/api/types';
import { useI18n } from '../shared/i18n/I18nProvider';
import { AudioButton } from '../shared/ui/AudioButton';
import { TapButton } from '../shared/ui/TapButton';
import { IconDocument, IconQuestion, IconShield } from '../shared/ui/Icons';

interface Turn {
  id: number;
  question: string;
  answer: RagAnswer | null;
  error: string | null;
}

const SUGGESTIONS_UR = [
  'میں درخواست کیسے دوں؟',
  'رقم کب ملے گی؟',
  'شناختی کارڈ نہیں ہے تو کیا کروں؟',
];

const SUGGESTIONS_EN = [
  'How do I apply?',
  'When will I get the money?',
  'What if I do not have a CNIC?',
];

/**
 * Ask a question — docs/11 §3.5, F-12.
 * Grounded RAG answers with citations. When the retriever is not confident the
 * answer is an explicit "we are not sure" plus a route to a human — never a guess.
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
    <div className="screen">
      <header className="mb-4 mt-1 flex items-start justify-between gap-3">
        <div>
          <h1 className="screen-title">{t('ask.title')}</h1>
          <p className="screen-hint">
            {lang === 'ur' ? 'اپنا سوال لکھیں یا بولیں۔' : 'Type or speak your question.'}
          </p>
        </div>
        <AudioButton audioKey="ask_intro" text={t('ask.title')} />
      </header>

      {turns.length === 0 && (
        <section className="card mb-3 p-4">
          <p className="mb-2 text-sm font-semibold text-ink-soft">
            {lang === 'ur' ? 'کوئی سوال منتخب کریں' : 'Pick a question'}
          </p>
          <ul className="space-y-2">
            {suggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => void ask(s)}
                  className="flex min-h-tap w-full items-center gap-2 rounded-2xl border-2 border-ink/15 px-3 text-start text-sm font-semibold text-ink"
                >
                  <IconQuestion size={18} className="shrink-0 text-teal-700" />
                  <span>{s}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="space-y-3">
        {turns.map((turn) => (
          <div key={turn.id} className="space-y-2">
            <div className="ms-auto max-w-[85%] rounded-2xl rounded-ee-md bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white">
              {turn.question}
            </div>

            {turn.error && (
              <div role="alert" className="rounded-2xl border-2 border-[#B42318]/40 bg-[#B42318]/10 px-4 py-3 text-sm font-semibold text-[#B42318]">
                {turn.error}
              </div>
            )}

            {!turn.answer && !turn.error && (
              <div className="max-w-[90%] rounded-2xl rounded-es-md bg-white px-4 py-3 text-sm text-ink-soft shadow-card">
                {t('common.loading')}
              </div>
            )}

            {turn.answer && (
              <div className="max-w-[92%] rounded-2xl rounded-es-md bg-white p-4 shadow-card">
                <div className="flex items-start gap-2">
                  <p className="flex-1 text-sm leading-relaxed text-ink">{turn.answer.answer}</p>
                  <AudioButton audioKey={null} text={turn.answer.answer} />
                </div>

                {turn.answer.status === 'NOT_SURE' && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2">
                    <IconShield size={18} className="mt-0.5 shrink-0 text-amber-700" />
                    <p className="text-xs font-semibold text-[#3B2A00]">{t('ask.notSure')}</p>
                  </div>
                )}

                {turn.answer.citations.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1 text-[11px] font-bold uppercase text-ink-soft">{t('ask.citations')}</p>
                    <ul className="space-y-1.5">
                      {turn.answer.citations.map((citation, index) => (
                        <li key={`${citation.doc_title}-${index}`} className="rounded-xl bg-ink/[0.04] px-3 py-2">
                          <p className="flex items-center gap-1.5 text-[11px] font-bold text-ink">
                            <IconDocument size={13} className="shrink-0 text-teal-700" />
                            {citation.doc_title} · {citation.section}
                          </p>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-soft">{citation.excerpt}</p>
                          <p className="num mt-0.5 text-[10px] text-ink-soft">
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

      <form
        className="sticky bottom-20 mt-4 flex items-end gap-2 rounded-2xl bg-white p-2 shadow-card"
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
          className="min-h-tap flex-1 resize-none border-0 bg-transparent px-2 text-base focus:ring-0"
        />
        <TapButton size="tap" type="submit" disabled={busy || question.trim().length === 0}>
          {t('ask.send')}
        </TapButton>
      </form>
    </div>
  );
}

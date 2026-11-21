import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api/client';
import { errorMessage } from '../api/errors';
import type { RagAnswer } from '../api/types';
import { useI18n } from '../i18n/I18nProvider';

export function TourQuestion({ topic, starter }: { topic: string; starter: string }) {
  const { pick, lang } = useI18n();
  const id = useId();
  const [question, setQuestion] = useState(starter);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<RagAnswer | null>(null);
  const [error, setError] = useState('');

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (busy || !text) return;
    setBusy(true);
    setError('');
    setAnswer(null);
    try {
      setAnswer(await api.post<RagAnswer>('/rag/ask', {
        question: `${text} (${topic})`,
        program_id: null,
        lang,
      }));
    } catch (err) {
      setError(errorMessage(err, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void ask(event)} className="mt-3 space-y-2 border-t border-ink/10 pt-3">
      <label htmlFor={id} className="block text-caption font-medium">
        {pick('اس مرحلے کے بارے میں سوال کریں', 'Ask about this step')}
      </label>
      <textarea id={id} className="field w-full resize-y" rows={2} maxLength={380}
        value={question} onChange={(event) => setQuestion(event.target.value)} />
      <p className="text-meta text-ink-3">
        {pick('صرف عام سوال کریں۔ ذاتی معلومات شامل نہ کریں۔', 'Ask a general question. Leave out personal details.')}
      </p>
      <button type="submit" disabled={busy || !question.trim()}
        className="press min-h-tap rounded-control border border-accent/25 px-3 text-caption font-medium text-accent-ink disabled:opacity-50">
        {busy ? pick('جواب آ رہا ہے', 'Finding an answer…') : pick('سوال بھیجیں', 'Send question')}
      </button>
      <div aria-live="polite">
        {error && <p className="text-caption text-negative">{error}</p>}
        {answer && (
          <div className="rounded-control bg-raised p-3 text-caption leading-[1.6]">
            <p className="whitespace-pre-wrap">{answer.answer}</p>
            {answer.citations.length > 0 && (
              <ul className="mt-2 list-disc ps-4 text-meta text-ink-3">
                {answer.citations.map((citation) => (
                  <li key={`${citation.doc_title}:${citation.section}:${citation.version}`}>{citation.doc_title} · {citation.section}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </form>
  );
}

import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api/client';
import { errorMessage } from '../api/errors';
import type { RagAnswer } from '../api/types';
import { useI18n } from '../i18n/I18nProvider';
import { AudioButton } from './AudioButton';

const QUESTION_LABEL_UR = 'اس مرحلے کے بارے میں سوال کریں';
const QUESTION_HINT_UR = 'صرف عام سوال کریں۔ ذاتی معلومات شامل نہ کریں۔';

export function TourQuestion({ topic, starter }: { topic: string; starter: string }) {
  const { pick, lang } = useI18n();
  const id = useId();
  const [question, setQuestion] = useState(starter);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<RagAnswer | null>(null);
  const [error, setError] = useState('');
  const currentRequest = useRef<AbortController | null>(null);
  useEffect(() => () => {
    const request = currentRequest.current;
    currentRequest.current = null;
    request?.abort();
  }, []);

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (busy || !text) return;
    const request = new AbortController();
    currentRequest.current = request;
    const timeout = window.setTimeout(() => request.abort(), 25000);
    setBusy(true);
    setError('');
    setAnswer(null);
    try {
      const result = await api.post<RagAnswer>('/rag/ask', {
        question: `${text} (${topic})`,
        program_id: null,
        lang,
      }, { signal: request.signal });
      if (currentRequest.current === request) setAnswer(result);
    } catch (err) {
      if (currentRequest.current === request) {
        setError(request.signal.aborted
          ? pick('جواب آنے میں دیر ہو گئی۔ دوبارہ کوشش کریں۔', 'The answer took too long. Try again.')
          : errorMessage(err, lang));
      }
    } finally {
      window.clearTimeout(timeout);
      if (currentRequest.current === request) {
        currentRequest.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <form onSubmit={(event) => void ask(event)} className="mt-3 space-y-2 border-t border-ink/10 pt-3">
      <div className="flex items-center gap-1">
        <label htmlFor={id} className="min-w-0 flex-1 text-caption font-medium">
          {pick(QUESTION_LABEL_UR, 'Ask about this step')}
        </label>
        <AudioButton text={QUESTION_LABEL_UR} label={pick('سوال کی ہدایت سنیں', 'Listen to the question prompt')} variant="quiet" />
      </div>
      <textarea id={id} className="field w-full resize-y" rows={2} maxLength={380}
        value={question} onChange={(event) => setQuestion(event.target.value)} />
      <div className="flex items-center gap-1">
        <p className="min-w-0 flex-1 text-meta text-ink-3">
          {pick(QUESTION_HINT_UR, 'Ask a general question. Leave out personal details.')}
        </p>
        <AudioButton text={QUESTION_HINT_UR} label={pick('رازداری کی ہدایت سنیں', 'Listen to the privacy reminder')} variant="quiet" />
      </div>
      <button type="submit" disabled={busy || !question.trim()}
        className="press min-h-tap rounded-control border border-accent/25 px-3 text-caption font-medium text-accent-ink disabled:opacity-50">
        {busy ? pick('جواب آ رہا ہے', 'Finding an answer…') : pick('سوال بھیجیں', 'Send question')}
      </button>
      <div aria-live="polite">
        {error && <p className="text-caption text-negative">{error}</p>}
        {answer && (
          <div className="rounded-control bg-raised p-3 text-caption leading-[1.6]">
            <div className="space-y-2">
              {answer.answer.split(/\n\s*\n/).filter((paragraph) => paragraph.trim()).map((paragraph, index) => (
                <div key={index} className="flex items-start gap-1">
                  <p className="min-w-0 flex-1 whitespace-pre-wrap">{paragraph}</p>
                  <AudioButton text={paragraph} label={pick(`جواب کا حصہ ${index + 1} سنیں`, `Listen to answer part ${index + 1}`)} variant="quiet" />
                </div>
              ))}
            </div>
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

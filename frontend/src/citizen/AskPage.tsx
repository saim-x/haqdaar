import { useMutation } from '@tanstack/react-query';
import { BookOpenText, HandHelping, Send, ShieldQuestion } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../shared/api/client';
import { ai } from '../shared/api/endpoints';
import type { RagAnswer } from '../shared/api/types';
import { play } from '../shared/audio';
import { useT } from '../shared/i18n';
import { AudioButton } from '../shared/ui/AudioButton';
import { Button } from '../shared/ui/Button';

const SUGGESTED = {
  ur: ['کون درخواست دے سکتا ہے؟', 'کون سی دستاویزات چاہئیں؟', 'رقم کتنی ملتی ہے؟', 'میں اپنی اجازت کیسے واپس لوں؟'],
  en: ['Who can apply?', 'Which documents are needed?', 'How much is the grant?', 'How do I take back my permission?'],
};

/** Policy Q&A with citations and an honest "I am not sure" (F-21, AC-21.2). */
export function AskPage() {
  const { t, lang } = useT();
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<{ q: string; a: RagAnswer }[]>([]);
  const [escalated, setEscalated] = useState<Set<number>>(new Set());

  const ask = useMutation({
    mutationFn: (q: string) => ai.ask(q, lang),
    onSuccess: (a, q) => {
      setHistory((h) => [{ q, a }, ...h]);
      setQuestion('');
      void play({ text: a.status === 'NOT_SURE' ? `${t('notSure')}. ${t('notSureBody')}` : a.answer, lang, clip: a.status === 'NOT_SURE' ? 'rag_not_sure' : undefined });
    },
  });

  return (
    <div className="space-y-5 animate-rise">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-3xl font-bold leading-tight">{t('askTitle')}</h1>
        <AudioButton clip="ask_intro" text={t('askTitle')} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim()) ask.mutate(question.trim());
        }}
        className="flex gap-2"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t('askPlaceholder')}
          aria-label={t('askPlaceholder')}
          className="min-h-tap-lg min-w-0 flex-1 rounded-control border-2 border-line-strong bg-surface px-4 text-lg"
        />
        <Button type="submit" size="lg" loading={ask.isPending} disabled={!question.trim()} aria-label={t('askSend')} icon={<Send className="h-6 w-6 rtl:-scale-x-100" aria-hidden />} />
      </form>

      {history.length === 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold text-muted">{t('suggested')}</h2>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED[lang].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => ask.mutate(s)}
                className="min-h-tap rounded-full border-2 border-line bg-surface px-4 font-medium hover:border-brand"
              >
                {s}
              </button>
            ))}
          </div>
        </section>
      )}

      {ask.error && (
        <p role="alert" className="rounded-control bg-danger-soft p-3 text-danger">
          {lang === 'ur' ? (ask.error as ApiError).messageUr : ask.error.message}
        </p>
      )}

      <ul className="space-y-4" aria-live="polite">
        {history.map(({ q, a }, i) => (
          <li key={`${q}-${i}`} className="space-y-2">
            <p className="ms-auto w-fit max-w-[85%] rounded-card rounded-ee-sm bg-brand px-4 py-2 font-medium text-brand-ink">{q}</p>
            {a.status === 'NOT_SURE' ? (
              <div className="rounded-card border-2 border-warn/50 bg-warn-soft p-4">
                <div className="flex items-start gap-3">
                  <ShieldQuestion className="h-8 w-8 shrink-0 text-warn" aria-hidden />
                  <div className="flex-1">
                    <p className="text-lg font-bold">{t('notSure')}</p>
                    <p className="mt-1">{t('notSureBody')}</p>
                  </div>
                  <AudioButton size="md" clip="rag_not_sure" text={`${t('notSure')}. ${t('notSureBody')}`} />
                </div>
                {escalated.has(i) ? (
                  <p className="mt-3 font-semibold text-ok">{t('askHumanSent')}</p>
                ) : (
                  <Button className="mt-3" variant="secondary" icon={<HandHelping className="h-5 w-5" aria-hidden />} onClick={() => setEscalated((s) => new Set(s).add(i))}>
                    {t('askHuman')}
                  </Button>
                )}
              </div>
            ) : (
              <div className="card p-4">
                <div className="flex items-start gap-3">
                  <p className="flex-1 whitespace-pre-line text-lg">{a.answer}</p>
                  <AudioButton size="md" text={a.answer} />
                </div>
                {a.citations.length > 0 && (
                  <div className="mt-3 border-t border-line pt-3">
                    <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-muted">
                      <BookOpenText className="h-4 w-4" aria-hidden />
                      {t('sources')}
                    </h3>
                    <ul className="space-y-2">
                      {a.citations.map((c, k) => (
                        <li key={k} className="rounded-control bg-sunken p-2 text-sm">
                          <p className="font-semibold">
                            {c.doc_title} · {c.section} <span className="text-muted">(v{c.version})</span>
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-muted">{c.excerpt}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="mt-3 text-xs text-muted">{t('askDisclaimer')}</p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

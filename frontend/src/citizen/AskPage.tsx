import { useMutation } from '@tanstack/react-query';
import {
  BookOpenText,
  HandHelping,
  Send,
  ShieldQuestion,
  MessageCircleQuestion,
  Loader2,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../shared/api/client';
import { ai } from '../shared/api/endpoints';
import type { RagAnswer } from '../shared/api/types';
import { play } from '../shared/audio';
import { useT } from '../shared/i18n';
import { AudioButton } from '../shared/ui/AudioButton';
import { Button } from '../shared/ui/Button';
import { Modal } from '../shared/ui/Modal';
import { useOnline } from '../shared/offline/outbox';

const SUGGESTED = {
  ur: [
    'کون درخواست دے سکتا ہے؟',
    'کون سی دستاویزات چاہئیں؟',
    'رقم کتنی ملتی ہے؟',
    'میں اپنی اجازت کیسے واپس لوں؟',
  ],
  en: [
    'Who can apply?',
    'Which documents are needed?',
    'How much is the grant?',
    'How do I take back my permission?',
  ],
};

/** Policy Q&A with citations and an honest "I am not sure" (F-21, AC-21.2). */
export function AskPage() {
  const { t, lang, pick } = useT();
  const online = useOnline();
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<{ q: string; a: RagAnswer }[]>([]);
  const [humanHelp, setHumanHelp] = useState(false);

  const ask = useMutation({
    mutationFn: (q: string) => ai.ask(q, lang),
    onSuccess: (a, q) => {
      setHistory((h) => [{ q, a }, ...h]);
      setQuestion('');
      void play({
        text: a.status === 'NOT_SURE' ? `${t('notSure')}. ${t('notSureBody')}` : a.answer,
        lang,
        clip: a.status === 'NOT_SURE' ? 'rag_not_sure' : undefined,
      });
    },
  });

  return (
    <div className="space-y-5 animate-rise">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="mb-2 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <MessageCircleQuestion className="h-6 w-6" aria-hidden />
          </span>
          <h1 className="text-2xl font-bold leading-tight">{t('askTitle')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {pick(
              'امدادی پالیسی کے جواب، ذریعہ کے ساتھ۔ فیصلہ صرف متعلقہ عمل کرتا ہے۔',
              'Policy guidance with sources. An answer here does not approve or reject an application.',
            )}
          </p>
        </div>
        <AudioButton clip="ask_intro" text={t('askTitle')} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim() && !ask.isPending && online) ask.mutate(question.trim());
        }}
        className="flex gap-2"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t('askPlaceholder')}
          aria-label={t('askPlaceholder')}
          className="min-h-tap-lg min-w-0 flex-1 rounded-xl border border-input bg-card px-4 text-base"
        />
        <Button
          type="submit"
          size="lg"
          loading={ask.isPending}
          disabled={!question.trim() || ask.isPending || !online}
          aria-label={t('askSend')}
          icon={<Send className="h-6 w-6 rtl:-scale-x-100" aria-hidden />}
        />
      </form>

      {history.length === 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold text-muted-foreground">{t('suggested')}</h2>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED[lang].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => ask.mutate(s)}
                disabled={ask.isPending || !online}
                className="min-h-tap rounded-xl border border-border bg-card px-4 text-start text-sm font-medium hover:border-primary disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        </section>
      )}

      {!online && (
        <p role="status" className="rounded-xl bg-warn-soft p-3 text-sm text-warn">
          {pick(
            'جواب کے لیے انٹرنیٹ چاہیے۔ آپ کے محفوظ جواب ضائع نہیں ہوں گے۔',
            'Connect to the internet to ask a question. Your saved application answers are safe.',
          )}
        </p>
      )}
      {ask.isPending && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground"
        >
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
          {pick('متعلقہ پالیسی میں جواب تلاش کیا جا رہا ہے…', 'Looking for an answer in the policy sources…')}
        </div>
      )}

      {ask.error && (
        <p role="alert" className="rounded-control bg-danger-soft p-3 text-danger">
          {lang === 'ur' ? (ask.error as ApiError).messageUr : ask.error.message}
        </p>
      )}

      <ul className="space-y-4" aria-live="polite">
        {history.map(({ q, a }, i) => (
          <li key={`${q}-${i}`} className="space-y-2">
            <p className="ms-auto w-fit max-w-[85%] rounded-card rounded-ee-sm bg-primary px-4 py-2 font-medium text-primary-foreground">
              {q}
            </p>
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
                <Button
                  className="mt-3"
                  variant="secondary"
                  icon={<HandHelping className="h-5 w-5" aria-hidden />}
                  onClick={() => setHumanHelp(true)}
                >
                  {t('askHuman')}
                </Button>
              </div>
            ) : (
              <div className="card p-4">
                <div className="flex items-start gap-3">
                  <p className="flex-1 whitespace-pre-line text-lg">{a.answer}</p>
                  <AudioButton size="md" text={a.answer} />
                </div>
                {a.citations.length > 0 && (
                  <div className="mt-3 border-t border-border pt-3">
                    <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-muted-foreground">
                      <BookOpenText className="h-4 w-4" aria-hidden />
                      {t('sources')}
                    </h3>
                    <ul className="space-y-2">
                      {a.citations.map((c, k) => (
                        <li key={k} className="rounded-xl bg-muted p-3 text-sm">
                          <details>
                            <summary className="min-h-12 cursor-pointer font-semibold">
                              {c.doc_title} · {c.section}{' '}
                              <span className="text-muted-foreground">(v{c.version})</span>
                            </summary>
                            <p className="mt-2 whitespace-pre-line text-muted-foreground">{c.excerpt}</p>
                          </details>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="mt-3 text-xs text-muted-foreground">{t('askDisclaimer')}</p>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Modal
        open={humanHelp}
        onClose={() => setHumanHelp(false)}
        title={pick('انسان سے مدد لیں', 'Get help from a person')}
        placement="sheet"
        closeLabel={t('close')}
      >
        <p className="text-sm leading-relaxed">
          {pick(
            'یہ سوال خودکار طور پر کسی کو نہیں بھیجا گیا۔ کسی قابلِ اعتماد کمیونٹی ہیلپر کو سوال دکھائیں۔ درخواست کی تفصیل میں افسر کی وجہ اور اگلا قدم دیکھ سکتے ہیں۔',
            'This question has not been sent to anyone. Show it to a trusted community helper. Your application details also show the officer’s explanation and next step when available.',
          )}
        </p>
        <Link
          to="/c/cases"
          className="mt-5 flex min-h-14 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-white"
        >
          {pick('اپنی درخواستیں دیکھیں', 'View my applications')}
        </Link>
      </Modal>
    </div>
  );
}

import { CircleAlert, CircleCheck, Pencil, Send } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { play } from '../../shared/audio';
import { formatPkr, useT } from '../../shared/i18n';
import type { DraftRow } from '../../shared/offline/db';
import { AudioButton } from '../../shared/ui/AudioButton';
import { Button } from '../../shared/ui/Button';
import { cx } from '../../shared/ui/cx';
import { submitDraft } from './draftActions';
import { DISTRICTS, formatCnic, type StepDef } from './steps';

export function ReviewStep({ steps, draft, onJump }: { steps: StepDef[]; draft: DraftRow; onJump: (id: string) => void }) {
  const { t, lang, pick } = useT();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [offlineDone, setOfflineDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const display = (s: StepDef): string | null => {
    if (s.kind === 'photo') {
      const d = draft.docs[s.docType!];
      if (!d) return null;
      if (d.status === 'SKIPPED') return t('notWithMe');
      if (d.status === 'NEEDS_RETAKE') return null;
      if (d.status === 'VERIFIED') return t('photoVerified');
      return t('savedLocally');
    }
    const a = draft.answers[s.id];
    if (!a) return null;
    if (a.value === null) return a.missing_reason ? t('unknownAnswer') : null;
    switch (s.kind) {
      case 'cnic':
        return formatCnic(String(a.value));
      case 'income':
        return formatPkr(Number(a.value), lang);
      case 'district': {
        const d = DISTRICTS.find((x) => x.value === a.value);
        return d ? pick(d.ur, d.value) : String(a.value);
      }
      default:
        return String(a.value);
    }
  };

  const items = steps.filter((s) => s.kind !== 'consent' && s.kind !== 'review');
  const missing = items.filter((s) => {
    const v = display(s);
    if (v !== null) return false;
    return s.required || (s.kind === 'photo' && draft.docs[s.docType!]?.status === 'NEEDS_RETAKE');
  });
  const summaryText = items
    .map((s) => `${t(s.question)} ${display(s) ?? t('notProvided')}`)
    .join('۔ ');

  const submit = async () => {
    if (missing.length) {
      setError(t('missingStep'));
      void play({ text: `${t('missingStep')}: ${t(missing[0].question)}`, lang, clip: 'missing_step' });
      return;
    }
    setBusy(true);
    setError(null);
    const out = await submitDraft(draft.localId);
    setBusy(false);
    if (out.status === 'sent') {
      void play({ text: t('submitted'), lang, clip: 'submitted' });
      nav(`/c/cases/${out.data.id}`, { replace: true });
    } else if (out.status === 'queued') {
      setOfflineDone(true);
      void play({ text: t('submitOffline'), lang, clip: 'submit_offline' });
    } else {
      setError(pick(out.error.messageUr, out.error.message));
    }
  };

  if (offlineDone) {
    return (
      <div className="space-y-4 text-center">
        <div className="rounded-card border-2 border-warn/40 bg-warn-soft p-6">
          <Send className="mx-auto mb-3 h-12 w-12 text-warn" aria-hidden />
          <p className="text-xl font-bold">{t('submitOffline')}</p>
        </div>
        <Button size="lg" variant="secondary" onClick={() => nav('/c')}>
          {t('home')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-card bg-primary-soft p-3">
        <AudioButton text={summaryText} label={t('q_review')} />
        <p className="font-semibold text-primary">{t('listen')}</p>
      </div>
      <ul className="card divide-y divide-border">
        {items.map((s) => {
          const v = display(s);
          const isMissing = missing.includes(s);
          return (
            <li key={s.id} className={cx('flex items-center gap-3 p-3', isMissing && 'bg-warn-soft')}>
              {isMissing ? (
                <CircleAlert className="h-6 w-6 shrink-0 text-warn" aria-label={t('missingStep')} />
              ) : (
                <CircleCheck className="h-6 w-6 shrink-0 text-ok" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted-foreground">{t(s.question)}</p>
                <p className={cx('truncate text-lg font-semibold', s.kind === 'cnic' && 'num')}>{v ?? t('missingStep')}</p>
              </div>
              <button
                type="button"
                onClick={() => onJump(s.id)}
                className="inline-flex min-h-tap items-center gap-1 rounded-full px-3 text-sm font-semibold text-primary hover:bg-primary-soft"
                aria-label={`${t('edit')}: ${t(s.question)}`}
              >
                <Pencil className="h-4 w-4" aria-hidden />
                {t('edit')}
              </button>
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="rounded-control bg-warn-soft p-3 text-center text-lg font-semibold text-warn">
          {error}
        </p>
      )}
      <div className="sticky bottom-3 pt-2">
        <Button size="xl" block variant="primary" loading={busy} onClick={() => void submit()} className="shadow-lift" icon={<Send className="h-7 w-7" aria-hidden />}>
          {t('submit')}
        </Button>
      </div>
    </div>
  );
}

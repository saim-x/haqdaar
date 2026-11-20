import { liveQuery } from 'dexie';
import { Camera, CircleCheck, CloudUpload, ImagePlus, RotateCcw, ShieldEllipsis } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../shared/api/client';
import { play } from '../../shared/audio';
import { useT } from '../../shared/i18n';
import { db, type DraftRow } from '../../shared/offline/db';
import { Button } from '../../shared/ui/Button';
import { cx } from '../../shared/ui/cx';
import { Spinner } from '../../shared/ui/Spinner';
import { compressImage } from './image';
import { markDocSkipped, uploadDocument } from './draftActions';
import type { StepDef } from './steps';

/**
 * Camera capture → client compression → immediate verification feedback.
 * TAMPER_SUSPECTED is shown to the citizen with the same calm wording as
 * UNVERIFIABLE: we never accuse anyone (docs/06 §8).
 */
export function PhotoStep({ step, draft, onNext }: { step: StepDef; draft: DraftRow; onNext: () => void }) {
  const { t, lang, pick } = useT();
  const docType = step.docType!;
  const doc = draft.docs[docType];
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Restore the local preview (works offline, survives reloads).
  useEffect(() => {
    if (!doc?.localBlobKey) return;
    let url: string | null = null;
    const sub = liveQuery(() => db.blobs.get(doc.localBlobKey!)).subscribe({
      next: (row) => {
        if (row?.blob) {
          url = URL.createObjectURL(row.blob);
          setPreview(url);
        }
      },
    });
    return () => {
      sub.unsubscribe();
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc?.localBlobKey]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setError(lang === 'ur' ? 'صرف تصویر (JPG / PNG) دیں۔' : 'Please choose a photo (JPG or PNG).');
      return;
    }
    setBusy(true);
    try {
      const blob = await compressImage(file);
      const out = await uploadDocument(draft.localId, docType, blob);
      if (out.status === 'sent') {
        const s = out.data.verify_status;
        if (s === 'VERIFIED') void play({ text: t('photoVerified'), lang, clip: 'photo_verified' });
        else if (s === 'NEEDS_RETAKE') {
          const msg = pick(out.data.retake_reason_ur, out.data.retake_reason_en) || t('photoRetakeDefault');
          void play({ text: msg, lang, clip: 'photo_retake' });
        } else void play({ text: t('photoUnverifiable'), lang, clip: 'photo_saved_officer' });
      } else if (out.status === 'queued') {
        void play({ text: t('photoQueued'), lang, clip: 'photo_queued' });
      } else {
        setError(pick(out.error.messageUr, out.error.message));
      }
    } catch (e) {
      setError(e instanceof ApiError ? pick(e.messageUr, e.message) : t('somethingWrong'));
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = '';
      if (galleryRef.current) galleryRef.current.value = '';
    }
  };

  const status = doc?.status;
  const needsRetake = status === 'NEEDS_RETAKE';
  const accepted = status === 'VERIFIED' || status === 'UNVERIFIABLE' || status === 'TAMPER_SUSPECTED' || status === 'QUEUED' || status === 'PENDING';

  let feedback: { tone: string; icon: JSX.Element; text: string } | null = null;
  if (busy) feedback = { tone: 'border-info/40 bg-info-soft text-info', icon: <Spinner className="h-7 w-7" />, text: t('checkingPhoto') };
  else if (status === 'VERIFIED') feedback = { tone: 'border-ok/40 bg-ok-soft text-ok', icon: <CircleCheck className="h-8 w-8" aria-hidden />, text: t('photoVerified') };
  else if (needsRetake)
    feedback = {
      tone: 'border-warn/50 bg-warn-soft text-warn',
      icon: <RotateCcw className="h-8 w-8" aria-hidden />,
      text: pick(doc?.retakeUr, doc?.retakeEn) || t('photoRetakeDefault'),
    };
  else if (status === 'UNVERIFIABLE' || status === 'TAMPER_SUSPECTED' || status === 'PENDING')
    feedback = { tone: 'border-info/40 bg-info-soft text-info', icon: <ShieldEllipsis className="h-8 w-8" aria-hidden />, text: t('photoUnverifiable') };
  else if (status === 'QUEUED') feedback = { tone: 'border-warn/40 bg-warn-soft text-warn', icon: <CloudUpload className="h-8 w-8" aria-hidden />, text: t('photoQueued') };

  return (
    <div className="space-y-4">
      <div
        className={cx(
          'relative flex aspect-[1.6] w-full items-center justify-center overflow-hidden rounded-card border-2 border-dashed bg-sunken',
          needsRetake ? 'border-warn' : status === 'VERIFIED' ? 'border-ok' : 'border-line-strong',
        )}
      >
        {preview ? (
          <img src={preview} alt="" className="h-full w-full object-contain" />
        ) : (
          <svg viewBox="0 0 160 100" className="h-3/5 text-line-strong" aria-hidden>
            <rect x="4" y="4" width="152" height="92" rx="10" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray="8 6" />
            <circle cx="42" cy="44" r="16" fill="currentColor" opacity="0.4" />
            <rect x="70" y="32" width="70" height="8" rx="4" fill="currentColor" opacity="0.4" />
            <rect x="70" y="50" width="50" height="8" rx="4" fill="currentColor" opacity="0.4" />
            <rect x="110" y="66" width="30" height="22" rx="3" fill="currentColor" opacity="0.6" />
          </svg>
        )}
      </div>

      {feedback && (
        <div role="status" aria-live="polite" className={cx('flex items-center gap-3 rounded-card border-2 p-4 text-lg font-semibold', feedback.tone)}>
          {feedback.icon}
          <span>{feedback.text}</span>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-control bg-danger-soft p-3 font-medium text-danger">
          {error}
        </p>
      )}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} tabIndex={-1} />
      <input ref={galleryRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} tabIndex={-1} />

      <div className="grid grid-cols-2 gap-3">
        <Button size="xl" variant={accepted ? 'secondary' : 'primary'} icon={<Camera className="h-8 w-8" aria-hidden />} onClick={() => cameraRef.current?.click()} disabled={busy} className="flex-col !gap-1 py-3">
          {needsRetake ? t('photoRetake') : t('takePhoto')}
        </Button>
        <Button size="xl" variant="secondary" icon={<ImagePlus className="h-8 w-8" aria-hidden />} onClick={() => galleryRef.current?.click()} disabled={busy} className="flex-col !gap-1 py-3">
          {t('choosePhoto')}
        </Button>
      </div>

      {step.allowUnknown && !accepted && (
        <Button
          size="lg"
          variant="ghost"
          block
          onClick={async () => {
            await markDocSkipped(draft.localId, docType);
            onNext();
          }}
        >
          {t('notWithMe')}
        </Button>
      )}

      {accepted && !busy && (
        <div className="sticky bottom-3 pt-2">
          <Button size="xl" block onClick={onNext} className="shadow-lift">
            {t('next')}
          </Button>
        </div>
      )}
    </div>
  );
}

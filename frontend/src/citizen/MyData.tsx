import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building, PencilLine, UserRound } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../shared/api/client';
import { me } from '../shared/api/endpoints';
import type { MyDataField } from '../shared/api/types';
import { currentCitizenId } from '../shared/auth/session';
import { formatDateTime, useT, type DictKey } from '../shared/i18n';
import { AudioButton } from '../shared/ui/AudioButton';
import { Button } from '../shared/ui/Button';
import { Modal } from '../shared/ui/Modal';
import { PageLoader } from '../shared/ui/Spinner';

/** "See my data" with provenance badges + correction requests (F-12). */
export function MyData() {
  const { t, lang, pick } = useT();
  const qc = useQueryClient();
  const citizenId = currentCitizenId();
  const q = useQuery({ queryKey: ['my-data', citizenId], queryFn: me.data });
  const [field, setField] = useState<MyDataField | null>(null);
  const [newValue, setNewValue] = useState('');
  const [reason, setReason] = useState('');

  const correct = useMutation({
    mutationFn: () => me.correct(field!.key, newValue.trim(), reason.trim()),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['my-data'] }),
  });

  if (q.isLoading) return <PageLoader label={t('loading')} />;
  if (q.error) return <p role="alert" className="rounded-control bg-danger-soft p-4 text-danger">{pick((q.error as ApiError).messageUr, q.error.message)}</p>;
  const data = q.data!;
  const fmt = (v: unknown) => (v === null || v === undefined || v === '' ? t('notProvided') : String(v));

  return (
    <div className="space-y-6 animate-rise">
      <h1 className="text-3xl font-bold">{t('myData')}</h1>
      {data.groups.map((g) => (
        <section key={g.category} className="space-y-2">
          <h2 className="text-lg font-bold">{t(`cat_${g.category}` as DictKey)}</h2>
          <ul className="card divide-y divide-border">
            {g.fields.map((f) => (
              <li key={f.key} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-muted-foreground">{pick(f.label_ur, f.label_en)}</p>
                  <p className="truncate text-lg font-semibold">{fmt(f.value)}</p>
                  <span
                    className={
                      f.source_type === 'REGISTRY'
                        ? 'mt-1 inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-xs font-semibold text-info'
                        : 'mt-1 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground'
                    }
                  >
                    {f.source_type === 'REGISTRY' ? <Building className="h-3.5 w-3.5" aria-hidden /> : <UserRound className="h-3.5 w-3.5" aria-hidden />}
                    {f.source_type === 'REGISTRY' ? t('sourceRegistry') : t('sourceSelf')}
                    {f.source_label ? ` · ${f.source_label}` : ''}
                  </span>
                </div>
                <AudioButton size="md" text={`${pick(f.label_ur, f.label_en)}: ${fmt(f.value)}`} className="!h-10 !w-10" />
                <button
                  type="button"
                  onClick={() => {
                    setField(f);
                    setNewValue(f.value === null || f.value === undefined ? '' : String(f.value));
                    setReason('');
                    correct.reset();
                  }}
                  className="inline-flex min-h-tap items-center gap-1 rounded-full px-3 text-sm font-semibold text-primary hover:bg-primary-soft"
                  aria-label={`${t('requestCorrection')}: ${pick(f.label_ur, f.label_en)}`}
                >
                  <PencilLine className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">{t('requestCorrection')}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {data.corrections.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-bold">{t('requestCorrection')}</h2>
          <ul className="card divide-y divide-border">
            {data.corrections.map((c) => (
              <li key={c.id} className="p-3">
                <p className="font-semibold">
                  {c.field_key}: <span className="num">{String(c.requested_value)}</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {c.status === 'APPLIED' || c.status === 'APPROVED' ? t('correctionApplied') : c.status === 'REJECTED' ? t('st_REJECTED') : t('correctionPending')} ·{' '}
                  <span className="num">{formatDateTime(c.created_at, lang)}</span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Modal
        open={!!field}
        onClose={() => setField(null)}
        title={field ? `${t('requestCorrection')}: ${pick(field.label_ur, field.label_en)}` : ''}
        closeLabel={t('close')}
        footer={
          correct.isSuccess ? (
            <Button onClick={() => setField(null)}>{t('close')}</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setField(null)}>
                {t('cancel')}
              </Button>
              <Button loading={correct.isPending} disabled={!newValue.trim()} onClick={() => correct.mutate()}>
                {t('confirm')}
              </Button>
            </>
          )
        }
      >
        {correct.isSuccess ? (
          <p className="text-lg font-semibold text-ok">
            {correct.data.status === 'APPLIED' ? t('correctionApplied') : `${t('correctionSent')}. ${t('correctionPending')}`}
          </p>
        ) : (
          <div className="space-y-3">
            {field?.source_type === 'REGISTRY' && <p className="rounded-control bg-info-soft p-3 text-info">{t('correctionPending')}</p>}
            <label className="block">
              <span className="mb-1 block font-semibold">{t('correctionNew')}</span>
              <input value={newValue} onChange={(e) => setNewValue(e.target.value)} className="min-h-tap-lg w-full rounded-control border-2 border-input bg-card px-3 text-lg" />
            </label>
            <label className="block">
              <span className="mb-1 block font-semibold">{t('correctionReason')}</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-tap w-full rounded-control border-2 border-input bg-card px-3" />
            </label>
            {correct.error && <p className="text-danger">{pick((correct.error as ApiError).messageUr, correct.error.message)}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

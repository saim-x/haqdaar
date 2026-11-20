import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../shared/api/client';
import { errorMessage } from '../shared/api/errors';
import type { CorrectionRequest, MyDataGroup } from '../shared/api/types';
import { useI18n } from '../shared/i18n/I18nProvider';
import { AudioButton } from '../shared/ui/AudioButton';
import { TapButton } from '../shared/ui/TapButton';
import { IconBadge, IconCheck, IconDocument, IconLock, IconRefresh, IconShield } from '../shared/ui/Icons';

interface MyDataResponse {
  groups: MyDataGroup[];
}

const CATEGORY_ICON: Record<string, typeof IconDocument> = {
  IDENTITY: IconBadge,
  HOUSEHOLD: IconShield,
  DOCUMENTS: IconDocument,
  PAYMENT: IconLock,
  CASE_HISTORY: IconRefresh,
};

/**
 * My Data — docs/11 §3.3, F-11.
 * Every field carries a provenance badge so a citizen can see whether a value
 * came from her own mouth or from a government registry, and can ask for a
 * correction on either.
 */
export function MyDataPage() {
  const { t, lang } = useI18n();
  const [correcting, setCorrecting] = useState<{ fieldKey: string; label: string; current: string } | null>(null);
  const [requested, setRequested] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<CorrectionRequest | null>(null);

  const data = useQuery({
    queryKey: ['me', 'data'],
    queryFn: () => api.get<MyDataResponse>('/me/data'),
    staleTime: 60_000,
  });

  async function submitCorrection() {
    if (!correcting) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<CorrectionRequest>('/me/corrections', {
        field_key: correcting.fieldKey,
        requested_value: requested,
        reason: reason.trim() || null,
      });
      setSent(created);
      setCorrecting(null);
      setRequested('');
      setReason('');
      void data.refetch();
    } catch (err) {
      setError(errorMessage(err, lang));
    } finally {
      setBusy(false);
    }
  }

  const groups = data.data?.groups ?? [];

  return (
    <div className="screen">
      <header className="mb-4 mt-1 flex items-start justify-between gap-3">
        <div>
          <h1 className="screen-title">{t('consent.myData')}</h1>
          <p className="screen-hint">
            {lang === 'ur'
              ? 'یہ سب معلومات ہمارے پاس محفوظ ہیں۔ ہر خانے کے ساتھ لکھا ہے کہ یہ کہاں سے آیا۔'
              : 'This is everything we store about you. Each field shows where it came from.'}
          </p>
        </div>
        <AudioButton audioKey="mydata_intro" text={t('consent.myData')} />
      </header>

      {sent && (
        <div role="status" className="mb-3 flex items-start gap-2 rounded-2xl border-2 border-[#0F7B3F]/40 bg-[#0F7B3F]/10 px-4 py-3">
          <IconCheck size={20} className="mt-0.5 shrink-0 text-[#0F7B3F]" />
          <p className="text-sm font-semibold text-[#0F7B3F]">
            {sent.status === 'APPLIED'
              ? lang === 'ur'
                ? 'آپ کی درستگی فوراً لگ گئی ہے۔'
                : 'Your correction was applied immediately.'
              : lang === 'ur'
                ? 'آپ کی درخواست افسر کے پاس گئی ہے۔'
                : 'Your request was sent to an officer.'}
          </p>
        </div>
      )}

      {error && (
        <div role="alert" className="mb-3 rounded-2xl border-2 border-[#B42318]/40 bg-[#B42318]/10 px-4 py-3 text-sm font-semibold text-[#B42318]">
          {error}
        </div>
      )}

      {data.isLoading && <p className="text-sm text-ink-soft">{t('common.loading')}</p>}

      {data.isError && (
        <div className="card p-4">
          <p className="text-sm text-ink-soft">{errorMessage(data.error, lang)}</p>
          <TapButton size="tap" variant="secondary" className="mt-3" onClick={() => void data.refetch()}>
            {t('common.tryAgain')}
          </TapButton>
        </div>
      )}

      <div className="space-y-3">
        {groups.map((group) => {
          const Icon = CATEGORY_ICON[group.category] ?? IconDocument;
          return (
            <section key={group.category} className="card overflow-hidden p-0">
              <div className="flex items-center gap-2 border-b border-ink/10 bg-ink/[0.03] px-4 py-2.5">
                <Icon size={18} className="text-teal-700" />
                <h2 className="flex-1 text-sm font-bold text-ink">{lang === 'ur' ? group.label_ur : group.label_en}</h2>
                <AudioButton
                  audioKey={`mydata_${group.category.toLowerCase()}`}
                  text={lang === 'ur' ? group.label_ur : group.label_en}
                />
              </div>
              <ul className="divide-y divide-ink/5">
                {group.fields.map((field) => {
                  const registry = field.source_type === 'REGISTRY';
                  return (
                    <li key={field.field_key} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                            {lang === 'ur' ? field.label_ur : field.label_en}
                          </p>
                          <p className="num mt-0.5 break-words text-base font-bold text-ink">
                            {field.value === null || field.value === '' ? '—' : String(field.value)}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            registry ? 'bg-[#1D4ED8]/10 text-[#1D4ED8]' : 'bg-teal-600/10 text-teal-700'
                          }`}
                        >
                          {registry ? t('consent.sourceRegistry') : t('consent.sourceSelf')}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setCorrecting({
                            fieldKey: field.field_key,
                            label: lang === 'ur' ? field.label_ur : field.label_en,
                            current: field.value === null ? '' : String(field.value),
                          })
                        }
                        className="mt-1.5 min-h-tap text-xs font-semibold text-teal-700 underline decoration-dotted underline-offset-2"
                      >
                        {t('consent.requestCorrection')}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {correcting && (
        <div className="fixed inset-0 z-50 flex items-end bg-ink/50 p-0 sm:items-center sm:justify-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="correction-title"
            className="w-full max-w-[520px] rounded-t-3xl bg-white p-5 sm:rounded-3xl"
          >
            <h2 id="correction-title" className="text-lg font-bold text-ink">
              {t('consent.requestCorrection')}
            </h2>
            <p className="mt-1 text-sm text-ink-soft">{correcting.label}</p>
            <p className="num mt-1 text-sm text-ink-soft">
              {lang === 'ur' ? 'ابھی محفوظ:' : 'Currently saved:'} {correcting.current || '—'}
            </p>

            <label htmlFor="correction-value" className="mt-3 block text-sm font-semibold text-ink">
              {lang === 'ur' ? 'صحیح معلومات لکھیں' : 'Write the correct value'}
            </label>
            <input
              id="correction-value"
              value={requested}
              onChange={(e) => setRequested(e.target.value)}
              className="mt-1 text-base"
            />

            <label htmlFor="correction-reason" className="mt-3 block text-sm font-semibold text-ink">
              {lang === 'ur' ? 'وجہ (اختیاری)' : 'Reason (optional)'}
            </label>
            <textarea
              id="correction-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 text-base"
            />

            <div className="mt-4 flex gap-2">
              <TapButton
                variant="secondary"
                size="tap"
                block
                onClick={() => {
                  setCorrecting(null);
                  setRequested('');
                  setReason('');
                }}
              >
                {t('common.cancel')}
              </TapButton>
              <TapButton
                size="tap"
                block
                disabled={busy || requested.trim().length === 0}
                onClick={() => void submitCorrection()}
              >
                {busy ? t('common.loading') : t('common.submit')}
              </TapButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

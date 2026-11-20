import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../shared/api/client';
import { ApiError, errorMessage } from '../shared/api/errors';
import type { CorrectionRequest, MyDataResponse, MyDataValue } from '../shared/api/types';
import { useI18n } from '../shared/i18n/I18nProvider';
import { AudioButton } from '../shared/ui/AudioButton';
import { TapButton } from '../shared/ui/TapButton';
import { IconBadge, IconCheck, IconDocument, IconLock, IconRefresh, IconShield } from '../shared/ui/Icons';
import { ConsentRevokedNotice } from '../shared/ui/ConsentRevoked';

/** Human labels for the canonical fact keys the server returns in `/me/data`. */
const FIELD_LABELS: Record<string, { ur: string; en: string }> = {
  full_name: { ur: 'پورا نام', en: 'Full name' },
  cnic_masked: { ur: 'شناختی کارڈ نمبر', en: 'CNIC number' },
  phone_masked: { ur: 'فون نمبر', en: 'Phone number' },
  district: { ur: 'ضلع', en: 'District' },
  dob: { ur: 'تاریخ پیدائش', en: 'Date of birth' },
  household_size: { ur: 'گھر میں افراد', en: 'People in household' },
  children_under_18: { ur: '18 سال سے کم بچے', en: 'Children under 18' },
  monthly_income_pkr: { ur: 'ماہانہ آمدنی', en: 'Monthly income' },
  poverty_score: { ur: 'غربت سکور', en: 'Poverty score' },
  payout_phone: { ur: 'رقم والا فون', en: 'Payout phone' },
};

const DOC_STATUS_LABELS: Record<string, { ur: string; en: string }> = {
  VERIFIED: { ur: 'تصدیق شدہ', en: 'Verified' },
  PENDING: { ur: 'جانچ جاری', en: 'Checking' },
  NEEDS_RETAKE: { ur: 'دوبارہ تصویر چاہیے', en: 'Retake needed' },
  UNVERIFIABLE: { ur: 'پڑھا نہیں جا سکا', en: 'Could not read' },
  TAMPER_SUSPECTED: { ur: 'جانچ ضروری', en: 'Needs a check' },
};

const DOC_TYPE_LABELS: Record<string, { ur: string; en: string }> = {
  CNIC_FRONT: { ur: 'شناختی کارڈ کی تصویر', en: 'CNIC photo' },
  SPOUSE_DEATH_CERTIFICATE: { ur: 'وفات کا سرٹیفکیٹ', en: 'Death certificate' },
  OTHER: { ur: 'دستاویز', en: 'Document' },
};

function prettyKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function fieldLabel(key: string, lang: 'ur' | 'en'): string {
  const known = FIELD_LABELS[key];
  if (known) return lang === 'ur' ? known.ur : known.en;
  return prettyKey(key);
}

function fmtDate(iso: string | null, lang: 'ur' | 'en'): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(lang === 'ur' ? 'ur-PK' : 'en-PK', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface Group {
  key: string;
  label_ur: string;
  label_en: string;
  icon: typeof IconDocument;
  fields: [string, MyDataValue][];
}

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

  const groups: Group[] = [];
  if (data.data) {
    const identity = Object.entries(data.data.identity ?? {});
    const household = Object.entries(data.data.household ?? {});
    if (identity.length) {
      groups.push({
        key: 'identity',
        label_ur: 'شناخت',
        label_en: 'Identity',
        icon: IconBadge,
        fields: identity,
      });
    }
    if (household.length) {
      groups.push({
        key: 'household',
        label_ur: 'گھریلو معلومات',
        label_en: 'Household',
        icon: IconShield,
        fields: household,
      });
    }
  }

  if (data.error instanceof ApiError && data.error.isConsentRevoked) {
    return <ConsentRevokedNotice backTo="/h" />;
  }

  const documents = data.data?.documents ?? [];
  const corrections = data.data?.corrections ?? [];

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
            {sent.applied
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
          const Icon = group.icon;
          return (
            <section key={group.key} className="card overflow-hidden p-0">
              <div className="flex items-center gap-2 border-b border-ink/10 bg-ink/[0.03] px-4 py-2.5">
                <Icon size={18} className="text-teal-700" />
                <h2 className="flex-1 text-sm font-bold text-ink">{lang === 'ur' ? group.label_ur : group.label_en}</h2>
                <AudioButton
                  audioKey={`mydata_${group.key}`}
                  text={lang === 'ur' ? group.label_ur : group.label_en}
                />
              </div>
              <ul className="divide-y divide-ink/5">
                {group.fields.map(([fieldKey, field]) => {
                  const registry = field.source !== 'SELF_DECLARED';
                  const label = fieldLabel(fieldKey, lang);
                  return (
                    <li key={fieldKey} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{label}</p>
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
                            fieldKey,
                            label,
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

        {documents.length > 0 && (
          <section className="card overflow-hidden p-0">
            <div className="flex items-center gap-2 border-b border-ink/10 bg-ink/[0.03] px-4 py-2.5">
              <IconDocument size={18} className="text-teal-700" />
              <h2 className="flex-1 text-sm font-bold text-ink">
                {lang === 'ur' ? 'دستاویزات' : 'Documents'}
              </h2>
            </div>
            <ul className="divide-y divide-ink/5">
              {documents.map((doc) => {
                const status = DOC_STATUS_LABELS[doc.verify_status] ?? { ur: doc.verify_status, en: doc.verify_status };
                const typeLabel = DOC_TYPE_LABELS[doc.doc_type] ?? { ur: doc.doc_type, en: doc.doc_type };
                const ok = doc.verify_status === 'VERIFIED';
                return (
                  <li key={doc.id} className="flex items-center gap-2 px-4 py-3">
                    <span
                      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${
                        ok ? 'bg-[#0F7B3F]/10 text-[#0F7B3F]' : 'bg-amber-500/15 text-amber-700'
                      }`}
                    >
                      {ok ? <IconCheck size={15} /> : <IconRefresh size={15} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink">{lang === 'ur' ? typeLabel.ur : typeLabel.en}</p>
                      <p className="text-[11px] text-ink-soft">
                        {lang === 'ur' ? status.ur : status.en} · <span className="num">{fmtDate(doc.created_at, lang)}</span>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {corrections.length > 0 && (
          <section className="card overflow-hidden p-0">
            <div className="flex items-center gap-2 border-b border-ink/10 bg-ink/[0.03] px-4 py-2.5">
              <IconLock size={18} className="text-teal-700" />
              <h2 className="flex-1 text-sm font-bold text-ink">
                {lang === 'ur' ? 'درستگی کی درخواستیں' : 'Correction requests'}
              </h2>
            </div>
            <ul className="divide-y divide-ink/5">
              {corrections.map((c) => (
                <li key={c.id} className="px-4 py-3">
                  <p className="text-sm font-semibold text-ink">{fieldLabel(c.field_key, lang)}</p>
                  <p className="text-[11px] text-ink-soft">
                    {lang === 'ur' ? c.message_ur : c.message_en}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
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

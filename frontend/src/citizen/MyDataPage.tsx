import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../shared/api/client';
import { ApiError, errorMessage } from '../shared/api/errors';
import type {
  CorrectionRequest,
  MissingReason,
  MyDataResponse,
  MyDataValue,
} from '../shared/api/types';
import { useI18n } from '../shared/i18n/I18nProvider';
import type { DictKey } from '../shared/i18n/dictionary';
import { ScreenHeader } from '../shared/ui/ScreenHeader';
import { AudioButton } from '../shared/ui/AudioButton';
import { TapButton } from '../shared/ui/TapButton';
import { IconCheck, IconPencil, IconRefresh } from '../shared/ui/Icons';
import { dayMonth } from '../shared/lib/dates';
import { ConsentRevokedNotice } from '../shared/ui/ConsentRevoked';

/** Human labels for the canonical fact keys the server returns in `/me/data`. */
const FIELD_LABELS: Record<string, { ur: string; en: string }> = {
  // The five identity keys `/me/data` always returns.
  full_name: { ur: 'پورا نام', en: 'Full name' },
  cnic_masked: { ur: 'شناختی کارڈ نمبر', en: 'CNIC number' },
  phone_masked: { ur: 'فون نمبر', en: 'Phone number' },
  district: { ur: 'ضلع', en: 'District' },
  dob: { ur: 'تاریخ پیدائش', en: 'Date of birth' },
  // The canonical fact keys from docs/04 §5, which is the only other set the
  // server can put in this payload.
  applicant_cnic: { ur: 'شناختی کارڈ نمبر', en: 'CNIC number' },
  applicant_full_name: { ur: 'پورا نام', en: 'Full name' },
  applicant_dob: { ur: 'تاریخ پیدائش', en: 'Date of birth' },
  applicant_age_years: { ur: 'عمر', en: 'Age' },
  applicant_is_alive: { ur: 'زندہ ہیں', en: 'Recorded as alive' },
  applicant_cnic_valid: { ur: 'کارڈ کی مدت', en: 'Card validity' },
  applicant_district: { ur: 'ضلع', en: 'District' },
  marital_status_widow: { ur: 'بیوہ', en: 'Recorded as widowed' },
  spouse_death_verified: { ur: 'شوہر کی وفات کی تصدیق', en: 'Spouse death verified' },
  spouse_full_name: { ur: 'شوہر کا نام', en: 'Spouse name' },
  spouse_cnic: { ur: 'شوہر کا شناختی کارڈ', en: 'Spouse CNIC' },
  children_under_18: { ur: '18 سال سے کم بچے', en: 'Children under 18' },
  household_size: { ur: 'گھر میں افراد', en: 'People in household' },
  monthly_income_pkr: { ur: 'ماہانہ آمدنی', en: 'Monthly income' },
  poverty_score: { ur: 'غربت سکور', en: 'Poverty score' },
  has_conflicting_active_grant: { ur: 'کوئی اور گرانٹ', en: 'Another active grant' },
  payout_phone: { ur: 'رقم والا فون', en: 'Payout phone' },
  cnic_doc_verified: { ur: 'شناختی کارڈ کی تصدیق', en: 'CNIC photo verified' },
  death_cert_doc_verified: { ur: 'وفات کے سرٹیفکیٹ کی تصدیق', en: 'Death certificate verified' },
  citizen_has_active_dept_consent: { ur: 'محکمے کی اجازت', en: 'Department access' },
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

/**
 * Why a value is `UNKNOWN`, in the citizen's words. The backend states the
 * reason rather than leaving the client to guess, so "we do not know" can say
 * *which* kind of not-knowing it is — "you have not told us" is a different
 * message from "a government service was down", and only one of them is the
 * citizen's to act on.
 */
const MISSING_LABEL: Record<MissingReason, DictKey> = {
  NOT_PROVIDED: 'consent.missingNotProvided',
  USER_UNKNOWN: 'consent.missingUserUnknown',
  NOT_APPLICABLE: 'consent.missingNotApplicable',
  SERVICE_UNAVAILABLE: 'consent.missingServiceUnavailable',
  DOCUMENT_MISSING: 'consent.missingDocumentMissing',
};

/** A value that is a bare ISO date is a date, not a string of digits. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function fieldValue(value: MyDataValue['value'], lang: 'ur' | 'en'): string {
  if (value === null || value === '') return '—';
  const text = String(value);
  return ISO_DATE.test(text) ? dayMonth(text, lang) : text;
}

interface Group {
  key: string;
  label_ur: string;
  label_en: string;
  fields: [string, MyDataValue][];
}

/**
 * My Data — docs/11 §3.3, F-11.
 *
 * Every field carries its provenance so a citizen can see whether a value came
 * from her own mouth or from a government registry, and can ask for a correction
 * on either.
 *
 * Provenance is quiet text under the value, not a coloured pill: five pills down
 * a column of ten fields is noise, and the distinction is already carried by the
 * words "Self-declared" and "Registry".
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
      groups.push({ key: 'identity', label_ur: 'شناخت', label_en: 'Identity', fields: identity });
    }
    if (household.length) {
      groups.push({ key: 'household', label_ur: 'گھریلو معلومات', label_en: 'Household', fields: household });
    }
  }

  if (data.error instanceof ApiError && data.error.isConsentRevoked) {
    return <ConsentRevokedNotice backTo="/h" />;
  }

  const documents = data.data?.documents ?? [];
  const corrections = data.data?.corrections ?? [];

  return (
    <div className="screen">
      <ScreenHeader
        title={t('consent.myData')}
        hint={
          lang === 'ur'
            ? 'یہ سب معلومات ہمارے پاس محفوظ ہیں۔ ہر خانے کے ساتھ لکھا ہے کہ یہ کہاں سے آیا۔'
            : 'This is everything we store about you. Each field shows where it came from.'
        }
        audioKey="mydata_intro"
        audioText={t('consent.myData')}
      />

      {sent && (
        <div
          role="status"
          className="mb-4 flex items-start gap-2 rounded-control border border-positive/25 bg-positive-wash px-4 py-3"
        >
          <IconCheck size={16} className="mt-1 shrink-0 text-positive" />
          <p className="text-caption font-medium leading-[1.7] text-positive">
            {sent.applied
              ? lang === 'ur'
                ? 'آپ کی درستگی فوراً لگ گئی ہے'
                : 'Your correction was applied immediately'
              : lang === 'ur'
                ? 'آپ کی درخواست افسر کے پاس گئی ہے'
                : 'Your request was sent to an officer'}
          </p>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-control border border-negative/25 bg-negative-wash px-4 py-3 text-caption font-medium text-negative"
        >
          {error}
        </div>
      )}

      {data.isLoading && (
        <p className="text-caption text-ink-3" role="status">
          {t('common.loading')}
        </p>
      )}

      {data.isError && (
        <div className="card p-4">
          <p className="text-caption text-ink-2">{errorMessage(data.error, lang)}</p>
          <TapButton size="tap" variant="secondary" className="mt-3" onClick={() => void data.refetch()}>
            {t('common.tryAgain')}
          </TapButton>
        </div>
      )}

      <div className="space-y-7">
        {groups.map((group) => (
          <section key={group.key} className="enter enter-2">
            {/* The screen-level speaker in the header reads the intro; each
                section gets its own quiet speaker so a citizen who only wants
                the household facts does not have to sit through the identity
                ones. `quiet` keeps the header button the prominent one. */}
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="section-label">{lang === 'ur' ? group.label_ur : group.label_en}</h2>
              <AudioButton
                audioKey={`mydata_${group.key}`}
                label={lang === 'ur' ? group.label_ur : group.label_en}
                variant="quiet"
                className="-my-2"
              />
            </div>
            {/* The row is the button. Seven identical "request a correction"
                links down one column is seven pieces of furniture; a pencil at
                the end of each row says the same thing once per row and keeps
                the value the loudest thing on the line. */}
            <ul className="border-y border-ink/[0.08]">
              {group.fields.map(([fieldKey, field]) => {
                const unknown = field.state === 'UNKNOWN';
                const registry = field.source !== 'SELF_DECLARED';
                const label = fieldLabel(fieldKey, lang);
                return (
                  <li key={fieldKey} className="border-b border-ink/[0.08] last:border-b-0">
                    <button
                      type="button"
                      onClick={() =>
                        setCorrecting({
                          fieldKey,
                          label,
                          current: field.value === null ? '' : String(field.value),
                        })
                      }
                      aria-label={`${t('consent.requestCorrection')}: ${label}`}
                      className="press flex min-h-primary w-full items-start gap-3 px-1 py-3 text-start hover:bg-raised/50"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-meta text-ink-3">{label}</span>
                        {/* An unknown value has no provenance to report. The
                            old row printed "Registry" for it, because a null
                            source is not SELF_DECLARED — so a field nobody had
                            answered claimed to come from a government record.
                            Unknown is a first-class value here: say so. */}
                        {unknown ? (
                          <>
                            <span className="mt-0.5 block text-body text-ink-3">
                              {t('consent.sourceUnknown')}
                            </span>
                            {field.missing_reason && (
                              <span className="mt-0.5 block text-meta text-ink-3">
                                {t(MISSING_LABEL[field.missing_reason])}
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            {/* `<bdi>` isolates the value without forcing a
                                direction, so a CNIC stays left-to-right and an
                                Urdu date stays right-to-left, and the block
                                still aligns to the start edge either way. */}
                            <span className="mt-0.5 block break-words font-mono text-body tabular-nums text-ink">
                              <bdi>{fieldValue(field.value, lang)}</bdi>
                            </span>
                            <span className="mt-0.5 block text-meta text-ink-3">
                              {registry ? t('consent.sourceRegistry') : t('consent.sourceSelf')}
                            </span>
                          </>
                        )}
                      </span>
                      <IconPencil size={16} className="mt-1 shrink-0 text-ink-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {documents.length > 0 && (
          <section className="enter enter-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="section-label">{t('data.documents')}</h2>
              <AudioButton
                audioKey="mydata_documents"
                label={t('data.documents')}
                variant="quiet"
                className="-my-2"
              />
            </div>
            <ul className="border-y border-ink/[0.08]">
              {documents.map((doc) => {
                const status = DOC_STATUS_LABELS[doc.verify_status] ?? { ur: doc.verify_status, en: doc.verify_status };
                const typeLabel = DOC_TYPE_LABELS[doc.doc_type] ?? { ur: doc.doc_type, en: doc.doc_type };
                const ok = doc.verify_status === 'VERIFIED';
                return (
                  <li
                    key={doc.id}
                    className="flex items-center gap-2.5 border-b border-ink/[0.08] py-2.5 last:border-b-0"
                  >
                    <span
                      aria-hidden
                      className={`live-dot ${ok ? 'bg-positive' : 'bg-warn'}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-caption font-medium text-ink">{lang === 'ur' ? typeLabel.ur : typeLabel.en}</p>
                      <p className="mt-0.5 text-meta text-ink-3">
                        {lang === 'ur' ? status.ur : status.en} ·{' '}
                        <bdi className="date">{dayMonth(doc.created_at, lang)}</bdi>
                      </p>
                    </div>
                    {ok ? (
                      <IconCheck size={16} className="shrink-0 text-positive" />
                    ) : (
                      <IconRefresh size={16} className="shrink-0 text-warn" />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {corrections.length > 0 && (
          <section className="enter enter-4">
            <h2 className="section-label mb-3">
              {t('data.corrections')}
            </h2>
            <ul className="border-y border-ink/[0.08]">
              {corrections.map((c) => (
                <li key={c.id} className="border-b border-ink/[0.08] py-2.5 last:border-b-0">
                  <p className="text-caption font-medium text-ink">{fieldLabel(c.field_key, lang)}</p>
                  <p className="mt-0.5 text-meta leading-[1.7] text-ink-3">
                    {lang === 'ur' ? c.message_ur : c.message_en}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {correcting && (
        <div
          className="fixed inset-0 z-50 grid place-items-end bg-ink/40 sm:place-items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="correction-title"
        >
          <div className="enter w-full max-w-[520px] rounded-t-panel border border-ink/[0.08] bg-card p-5 sm:rounded-panel">
            <h2 id="correction-title" className="text-lead font-medium leading-[1.4] text-ink">
              {t('consent.requestCorrection')}
            </h2>
            <p className="mt-1 text-caption text-ink-2">{correcting.label}</p>
            <p className="num mt-0.5 font-mono text-caption text-ink-3">
              {t('data.currentlySaved')}: {correcting.current || '—'}
            </p>

            <label htmlFor="correction-value" className="mt-4 block text-caption font-medium text-ink">
              {t('data.correctValue')}
            </label>
            <input
              id="correction-value"
              value={requested}
              onChange={(e) => setRequested(e.target.value)}
              className="mt-1"
            />

            <label htmlFor="correction-reason" className="mt-3 block text-caption font-medium text-ink">
              {t('data.reasonOptional')}
            </label>
            <textarea
              id="correction-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1"
            />

            <div className="mt-5 flex gap-2">
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

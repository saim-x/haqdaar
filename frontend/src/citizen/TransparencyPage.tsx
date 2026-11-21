import { useQuery } from '@tanstack/react-query';
import { api } from '../shared/api/client';
import type { TransparencyPayload, TransparencyStatus } from '../shared/api/types';
import { useI18n } from '../shared/i18n/I18nProvider';
import { ScreenHeader } from '../shared/ui/ScreenHeader';
import { IconCheck, IconInfo, IconRefresh, IconWarning } from '../shared/ui/Icons';

/**
 * The three honesty badges, in the order the backend defines them. `SYNTHETIC`
 * is not a weaker `SIMULATED`: it says the *data* is invented, which is a
 * different claim from "this service is a mock", so it gets its own word.
 */
const STATUS: Record<
  TransparencyStatus,
  { tone: string; Icon: typeof IconCheck; key: 'transparency.real' | 'transparency.simulated' | 'transparency.synthetic' }
> = {
  REAL: { tone: 'text-positive', Icon: IconCheck, key: 'transparency.real' },
  SIMULATED: { tone: 'text-warn', Icon: IconWarning, key: 'transparency.simulated' },
  SYNTHETIC: { tone: 'text-info', Icon: IconInfo, key: 'transparency.synthetic' },
};

const MODE_TONE: Record<string, string> = {
  NORMAL: 'text-ink-2',
  SLOW: 'text-warn',
  FLAKY: 'text-warn',
  DOWN: 'text-negative',
};

/**
 * /transparency — RULE-5 / AC-25.2.
 *
 * The Real vs Simulated table from docs/15 §1, rendered identically for citizens
 * and judges. Public: no login required.
 *
 * This is a reference table, so it is set as one: hairline rules, a quiet header,
 * and the verdict as a dot plus a word rather than a coloured pill per row.
 *
 * The English `details` strings come from the backend untranslated, so each one
 * is wrapped in `<bdi>`: without isolation the trailing full stop is a neutral
 * character and RTL reorders it to the front of the sentence.
 */
export function TransparencyPage() {
  const { t, lang } = useI18n();
  const query = useQuery({
    queryKey: ['transparency'],
    queryFn: () => api.get<TransparencyPayload>('/transparency', { anonymous: true }),
    staleTime: 60_000,
  });

  const rows = query.data?.components ?? [];
  const services = query.data?.mock_services ?? [];

  return (
    <div className="screen">
      <ScreenHeader
        title={t('transparency.title')}
        hint={t('transparency.subtitle')}
        audioKey="transparency_intro"
        audioText={t('transparency.subtitle')}
      />

      <div className="enter enter-2 rounded-control border border-warn/25 bg-warn-wash px-4 py-3">
        <p className="text-caption leading-[1.7] text-warn">{t('transparency.noRealData')}</p>
        {query.data?.synthetic_data && (
          <p className="mt-1.5 text-meta leading-[1.7] text-ink-2">
            {lang === 'ur'
              ? `تمام شناختی کارڈ نمبر ${query.data.synthetic_data.cnic_prefix} سے شروع ہوتے ہیں۔`
              : `Every CNIC starts with the fictional prefix ${query.data.synthetic_data.cnic_prefix}.`}
          </p>
        )}
      </div>

      <table className="ledger enter enter-3 mt-6">
        <thead>
          <tr>
            <th>{t('transparency.component')}</th>
            <th className="w-24">{t('transparency.status')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const status = STATUS[row.status] ?? STATUS.SIMULATED;
            return (
              <tr key={row.component}>
                <td>
                  <p className="font-medium text-ink">{lang === 'ur' ? row.name_ur : row.component}</p>
                  <p className="mt-0.5 text-meta leading-[1.7] text-ink-3">
                    <bdi>{row.details}</bdi>
                  </p>
                </td>
                <td className="whitespace-nowrap">
                  <span className={`inline-flex items-center gap-1.5 text-meta font-medium ${status.tone}`}>
                    <status.Icon size={13} />
                    {t(status.key)}
                  </span>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={2} className="py-4 text-center text-ink-3">
                {query.isLoading ? (
                  t('common.loading')
                ) : query.isError ? (
                  <button
                    type="button"
                    onClick={() => void query.refetch()}
                    className="press inline-flex min-h-tap items-center gap-1.5 text-caption font-medium text-accent-ink hover:underline"
                  >
                    <IconRefresh size={14} />
                    {t('common.retry')}
                  </button>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {services.length > 0 && (
        <section className="enter enter-4 mt-8">
          <h2 className="section-label">{t('transparency.services')}</h2>
          <p className="mb-3 mt-1 text-meta leading-[1.7] text-ink-3">{t('transparency.servicesHint')}</p>
          <table className="ledger">
            <thead>
              <tr>
                <th>{t('transparency.service')}</th>
                <th className="w-24">{t('transparency.mode')}</th>
              </tr>
            </thead>
            <tbody>
              {services.map((service) => (
                <tr key={service.service_name}>
                  <td className="text-ink">
                    {t(`mockService.${service.service_name}` as 'mockService.identity')}
                  </td>
                  <td className={`whitespace-nowrap font-medium ${MODE_TONE[service.mode] ?? 'text-ink-2'}`}>
                    {t(`mockMode.${service.mode}` as 'mockMode.NORMAL')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <dl className="mt-6 space-y-1.5 border-t border-ink/[0.08] pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-meta text-ink-3">{t('transparency.aiProvider')}</dt>
          <dd className="text-meta font-medium text-ink-2">
            {query.data?.ai_provider === 'live'
              ? t('transparency.aiProviderLive')
              : t('transparency.aiProviderFake')}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-meta leading-[1.7] text-ink-3">{t('transparency.docs')}</p>
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { api } from '../shared/api/client';
import type { TransparencyPayload } from '../shared/api/types';
import { useI18n } from '../shared/i18n/I18nProvider';
import { ScreenHeader } from '../shared/ui/ScreenHeader';
import { IconCheck, IconWarning } from '../shared/ui/Icons';

/**
 * /transparency — RULE-5 / AC-25.2.
 *
 * The Real vs Simulated table from docs/15 §1, rendered identically for citizens
 * and judges. Public: no login required.
 *
 * This is a reference table, so it is set as one: hairline rules, a quiet header,
 * and the verdict as a dot plus a word rather than a coloured pill per row.
 */
export function TransparencyPage() {
  const { t, lang } = useI18n();
  const query = useQuery({
    queryKey: ['transparency'],
    queryFn: () => api.get<TransparencyPayload>('/transparency', { anonymous: true }),
    staleTime: 60_000,
  });

  const rows = query.data?.subsystems ?? [];

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
          {rows.map((row) => (
            <tr key={row.name}>
              <td>
                <p className="font-medium text-ink">{lang === 'ur' ? row.name_ur : row.name}</p>
                <p className="mt-0.5 text-meta leading-[1.7] text-ink-3">{row.detail}</p>
              </td>
              <td className="whitespace-nowrap">
                <span
                  className={`inline-flex items-center gap-1.5 text-meta font-medium ${
                    row.real ? 'text-positive' : 'text-warn'
                  }`}
                >
                  {row.real ? <IconCheck size={13} /> : <IconWarning size={13} />}
                  {row.real
                    ? lang === 'ur'
                      ? 'اصلی'
                      : 'Real'
                    : lang === 'ur'
                      ? 'نقلی'
                      : 'Simulated'}
                </span>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={2} className="py-4 text-center text-ink-3">
                {query.isLoading ? t('common.loading') : '—'}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {query.data?.mock_statuses_note && (
        <p className="mt-4 text-meta leading-[1.7] text-ink-3">{query.data.mock_statuses_note}</p>
      )}

      <p className="mt-4 text-meta leading-[1.7] text-ink-3">
        {lang === 'ur'
          ? 'مکمل تکنیکی تفصیل کے لیے /api/docs دیکھیں۔'
          : 'See /api/docs for the full machine-readable API surface.'}
      </p>
    </div>
  );
}

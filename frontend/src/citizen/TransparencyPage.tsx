import { useQuery } from '@tanstack/react-query';
import { api } from '../shared/api/client';
import type { TransparencyPayload } from '../shared/api/types';
import { useI18n } from '../shared/i18n/I18nProvider';
import { AudioButton } from '../shared/ui/AudioButton';
import { IconCheck, IconWarning } from '../shared/ui/Icons';

/**
 * /transparency — RULE-5 / AC-25.2.
 * The Real vs Simulated table from docs/15 §1, rendered identically for citizens
 * and judges. Public: no login required.
 */
export function TransparencyPage() {
  const { t, lang } = useI18n();
  const query = useQuery({
    queryKey: ['transparency'],
    queryFn: () => api.get<TransparencyPayload>('/transparency', { anonymous: true }),
    staleTime: 60_000,
  });

  const rows = query.data?.components ?? [];

  return (
    <div className="screen">
      <header className="mb-4 mt-2 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{t('transparency.title')}</h1>
          <p className="text-sm text-ink-soft">{t('transparency.subtitle')}</p>
        </div>
        <AudioButton audioKey="transparency_intro" text={t('transparency.subtitle')} />
      </header>

      <div className="card mb-4 border-2 border-amber-400/60 bg-amber-50 p-3">
        <p className="text-xs font-semibold leading-relaxed text-[#3B2A00]">{t('transparency.noRealData')}</p>
      </div>

      <div className="card overflow-hidden p-0">
        <table className="w-full text-start text-xs">
          <thead>
            <tr className="border-b border-ink/10 bg-ink/5 text-[10px] uppercase tracking-wide text-ink-soft">
              <th className="px-3 py-2 text-start">{t('transparency.component')}</th>
              <th className="px-3 py-2 text-start">{t('transparency.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.component} className="border-b border-ink/5 last:border-0">
                <td className="px-3 py-2">
                  <p className="font-semibold text-ink">{row.component}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-soft">{row.details}</p>
                </td>
                <td className="px-3 py-2 align-top">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      row.status === 'REAL'
                        ? 'bg-[#0F7B3F]/10 text-[#0F7B3F]'
                        : row.status === 'SIMULATED'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-[#6D28D9]/10 text-[#6D28D9]'
                    }`}
                  >
                    {row.status === 'REAL' ? <IconCheck size={10} /> : <IconWarning size={10} />}
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={2} className="px-3 py-4 text-center text-ink-soft">
                  {query.isLoading ? t('common.loading') : '—'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-center text-[11px] text-ink-soft">
        {lang === 'ur'
          ? 'مکمل تکنیکی تفصیل کے لیے /api/docs دیکھیں۔'
          : 'See /api/docs for the full machine-readable API surface.'}
      </p>
    </div>
  );
}

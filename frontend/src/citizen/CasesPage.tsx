import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../shared/api/client';
import { ApiError } from '../shared/api/errors';
import type { CaseListResponse } from '../shared/api/types';
import { useAuth } from '../shared/auth/AuthProvider';
import { useI18n } from '../shared/i18n/I18nProvider';
import { AudioButton } from '../shared/ui/AudioButton';
import { StatusBadge } from '../shared/ui/StatusBadge';
import { TapLink } from '../shared/ui/TapButton';
import { IconChevron, IconDocument } from '../shared/ui/Icons';
import { ConsentRevokedNotice } from '../shared/ui/ConsentRevoked';

/** My Applications — docs/11 §3.1 tile 2, F-10. */
export function CasesPage() {
  const { t, pick } = useI18n();
  const { actFor, session } = useAuth();

  const query = useQuery({
    queryKey: ['cases', actFor?.citizenId ?? session?.citizen?.id ?? 'self'],
    queryFn: () => api.get<CaseListResponse>('/cases'),
    refetchInterval: 30_000,
  });

  // A helper whose citizen withdrew consent gets a zero-PII lock screen, not a
  // generic error (AC-13.2).
  if (query.error instanceof ApiError && query.error.isConsentRevoked) {
    return <ConsentRevokedNotice backTo="/h" />;
  }

  return (
    <div className="screen">
      <header className="mb-4 mt-1 flex items-start justify-between gap-3">
        <h1 className="screen-title">{t('cases.title')}</h1>
        <AudioButton audioKey="cases_title" text={t('cases.title')} />
      </header>

      {query.isLoading && <p className="text-sm text-ink-soft">{t('common.loading')}</p>}
      {query.error && (
        <div role="alert" className="rounded-2xl border-2 border-[#B42318]/40 bg-[#B42318]/10 px-4 py-3 text-sm font-semibold text-[#B42318]">
          {t('common.error')}
        </div>
      )}

      {query.data && query.data.items.length === 0 && (
        <div className="card p-6 text-center">
          <IconDocument size={40} className="mx-auto text-ink-soft" />
          <p className="mt-2 text-sm text-ink-soft">{t('cases.empty')}</p>
          <TapLink to="/c" className="mt-4" size="tap">
            {t('cases.newApplication')}
          </TapLink>
        </div>
      )}

      <ul className="space-y-3">
        {query.data?.items.map((item) => (
          <li key={item.id}>
            <Link
              to={`/c/cases/${item.id}`}
              className="card flex min-h-[96px] items-center gap-3 p-4 transition active:scale-[0.99]"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ink">{pick(item.program.name_ur, item.program.name)}</p>
                <p className="num mt-0.5 text-xs text-ink-soft">{item.reference_code}</p>
                <div className="mt-2">
                  <StatusBadge status={item.status} size="sm" />
                </div>
              </div>
              <IconChevron size={20} className="shrink-0 text-ink-soft rtl:rotate-180" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

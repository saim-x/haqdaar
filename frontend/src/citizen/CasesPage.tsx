import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../shared/api/client';
import { ApiError } from '../shared/api/errors';
import type { CaseListResponse } from '../shared/api/types';
import { useAuth } from '../shared/auth/AuthProvider';
import { useI18n } from '../shared/i18n/I18nProvider';
import { StatusBadge } from '../shared/ui/StatusBadge';
import { ScreenHeader } from '../shared/ui/ScreenHeader';
import { TapLink } from '../shared/ui/TapButton';
import { IconChevron, IconDocument } from '../shared/ui/Icons';
import { ConsentRevokedNotice } from '../shared/ui/ConsentRevoked';

/**
 * My Applications — docs/11 §3.1 tile 2, F-10.
 *
 * A list, so it is a list: one row height, one gap, the reference in mono and
 * the status as a dot plus a label. The chevron is the only thing on the end
 * edge, so the eye runs down one column.
 */
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
      <ScreenHeader title={t('cases.title')} audioKey="cases_title" audioText={t('cases.title')} />

      {query.isLoading && (
        <p className="text-caption text-ink-3" role="status">
          {t('common.loading')}
        </p>
      )}

      {query.error && (
        <div
          role="alert"
          className="rounded-control border border-negative/25 bg-negative-wash px-4 py-3 text-caption font-medium text-negative"
        >
          {t('common.error')}
        </div>
      )}

      {query.data && query.data.items.length === 0 && (
        <div className="card enter enter-2 px-6 py-10 text-center">
          <IconDocument size={28} className="mx-auto text-ink-3" />
          <p className="mt-3 text-body text-ink-2">{t('cases.empty')}</p>
          <TapLink to="/c" size="tap" className="mt-5">
            {t('cases.newApplication')}
          </TapLink>
        </div>
      )}

      {query.data && query.data.items.length > 0 && (
        <ul className="enter enter-2 border-y border-ink/[0.08]">
          {query.data.items.map((item) => (
            <li key={item.id} className="border-b border-ink/[0.08] last:border-b-0">
              <Link
                to={`/c/cases/${item.id}`}
                className="press flex min-h-primary items-center gap-3 px-1 py-3 hover:bg-raised/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium text-ink">
                    {pick(item.program.name_ur, item.program.name)}
                  </p>
                  <p className="num mt-0.5 font-mono text-meta text-ink-3">{item.reference_code}</p>
                  <div className="mt-1.5">
                    <StatusBadge status={item.status} size="sm" />
                  </div>
                </div>
                <IconChevron size={16} className="shrink-0 text-ink-3" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

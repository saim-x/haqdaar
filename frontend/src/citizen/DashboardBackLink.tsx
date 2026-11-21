import { useAuth } from '../shared/auth/AuthProvider';
import { useI18n } from '../shared/i18n/I18nProvider';
import { BackLink } from '../shared/ui/BackLink';

/**
 * The way out of a screen that has no tab bar.
 *
 * Two places need it. The wizard hides the tab bar for the whole flow, and its
 * bottom Back button is disabled on the first step — so before this link
 * existed, a citizen who opened the form and changed her mind had no exit at
 * all. The public routes (`/scam-check`, `/transparency`) sit outside
 * CitizenLayout, so they have no shell either.
 *
 * It renders nothing for staff: an officer has a sidebar, and a link to a
 * citizen dashboard would be a dead end.
 */
export function DashboardBackLink({ onClick }: { onClick?: () => void }) {
  const { session } = useAuth();
  const { t } = useI18n();
  const role = session?.user.role;
  if (role !== 'CITIZEN' && role !== 'HELPER') return null;

  return <BackLink to="/c" label={t('home.backToDashboard')} onClick={onClick} />;
}

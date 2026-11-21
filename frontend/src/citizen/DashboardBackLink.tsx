import { useAuth } from '../shared/auth/AuthProvider';
import { useI18n } from '../shared/i18n/I18nProvider';
import { BackLink } from '../shared/ui/BackLink';

/**
 * Exit the application wizard, where the dashboard tab bar is hidden.
 */
export function DashboardBackLink({ onClick }: { onClick?: () => void }) {
  const { session } = useAuth();
  const { t } = useI18n();
  const role = session?.user.role;
  if (role !== 'CITIZEN' && role !== 'HELPER') return null;

  return <BackLink to="/c" label={t('home.backToDashboard')} onClick={onClick} />;
}

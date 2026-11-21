import { Link } from 'react-router-dom';
import { useAuth } from '../shared/auth/AuthProvider';
import { useI18n } from '../shared/i18n/I18nProvider';
import { IconArrowLeft } from '../shared/ui/Icons';

export function DashboardBackLink({ onClick }: { onClick?: () => void }) {
  const { session } = useAuth();
  const { t } = useI18n();
  const role = session?.user.role;
  if (role !== 'CITIZEN' && role !== 'HELPER') return null;

  return (
    <Link
      to="/c"
      onClick={onClick}
      className="inline-flex min-h-tap items-center gap-2 rounded-xl px-3 text-sm font-bold text-teal-700 hover:bg-teal-50"
    >
      <IconArrowLeft size={18} className="shrink-0 rtl:rotate-180" />
      {t('home.backToDashboard')}
    </Link>
  );
}
